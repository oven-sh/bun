// An archive of files: a bit stream, dictionaries, prefix codes, sums, a tree of folders with entries that are added, listed, extracted and checked
export class FormatError extends Error {
  constructor(message: string, readonly offset: number) {
    super(`${message} at ${offset}`);
    this.name = "FormatError";
  }
}
export const enum Method {
  Stored, Runs, Packed
}
export interface EntryInfo {
  readonly path: string;
  readonly size: number;
  readonly packed: number;
  readonly method: Method;
  readonly sum: number;
  readonly time: number
}
export class BitWriter {
  #bytes: number[] = [];
  #bit = 0;
  write(value: number, width: number): this {
    for (let i = 0; i < width; i++) {
      if (this.#bit === 0) this.#bytes.push(0);
      if ((value >>> i) & 1) this.#bytes[this.#bytes.length - 1] |= 1 << this.#bit;
      this.#bit = (this.#bit + 1) & 7;
    }
    return this;
  }
  align(): this {
    this.#bit = 0;
    return this;
  }
  get length() {
    return this.#bytes.length;
  }
  bytes() {
    return Uint8Array.from(this.#bytes);
  }
}
export class BitReader {
  #bit = 0;
  constructor(readonly bytes: Uint8Array, public at = 0, readonly end = bytes.length) {
  }
  read(width: number): number {
    let v = 0;
    for (let i = 0; i < width; i++) {
      if (this.at >= this.end) throw new FormatError("bits end", this.at);
      if ((this.bytes[this.at] >>> this.#bit) & 1) v |= 1 << i;
      if (++this.#bit === 8) {
        this.#bit = 0;
        this.at++;
      }
    }
    return v >>> 0;
  }
  align() {
    if (this.#bit) {
      this.#bit = 0;
      this.at++;
    }
  }
}
export namespace Sum {
  const table = Uint32Array.from({ length: 256 }, (_, n) => {
    for (let k = 0; k < 8; k++) n = n & 1 ? (n >>> 1) ^ 0xedb88320 : n >>> 1;
    return n >>> 0;
});
  export function crc(bytes: Uint8Array, start = 0): number {
    let c = ~start;
    for (let i = 0; i < bytes.length; i++) c = table[(c ^ bytes[i]) & 255] ^ (c >>> 8);
    return ~c >>> 0;
  }
  export function adler(bytes: Uint8Array): number {
    let a = 1, b = 0;
    for (const x of bytes) {
      a = (a + x) % 65521;
      b = (b + a) % 65521;
    }
    return ((b << 16) | a) >>> 0;
  }
}
export class PrefixCode {
  private constructor(readonly lengths: Uint8Array, readonly codes: Uint32Array) {
  }
  static readonly MAX = 15;
  static fromCounts(counts: ArrayLike<number>): PrefixCode {
    type Node = {
      n: number;
      symbol: number;
      a?: Node;
      b?: Node;
      order: number
  };
    let order = 0;
    const nodes: Node[] = [];
    for (let s = 0; s < counts.length; s++) if (counts[s]) nodes.push({ n: counts[s],
      symbol: s, order: order++ });
    const lengths = new Uint8Array(counts.length);
    if (nodes.length === 1) lengths[nodes[0].symbol] = 1;
    const less = (x: Node, y: Node) => x.n - y.n || x.order - y.order;
    nodes.sort(less);
    while (nodes.length > 1) {
      const a = nodes.shift()!, b = nodes.shift()!;
      const n: Node = {
        n: a.n + b.n, symbol: -1, a, b, order: order++
    };
      let i = nodes.findIndex(x => less(n, x) < 0);
      if (i < 0) i = nodes.length;
      nodes.splice(i, 0, n);
    }
    const walk = (n: Node, depth: number) => {
      if (n.symbol >= 0) {
        if (depth) lengths[n.symbol] = Math.min(depth, PrefixCode.MAX);
        return;
      }
      walk(n.a!, depth + 1);
      walk(n.b!, depth + 1);
  };
    if (nodes[0]) walk(nodes[0], 0);
    let over = 0;
    for (const l of lengths) if (l) over += 2 ** (PrefixCode.MAX - l);
    for (let l = PrefixCode.MAX - 1; over > 2 ** PrefixCode.MAX && l > 0; ) {
      const s = lengths.indexOf(l);
      if (s < 0) {
        l--;
        continue;
      }
      lengths[s]++;
      over -= 2 ** (PrefixCode.MAX - l - 1);
    }
    return PrefixCode.fromLengths(lengths);
  }
  static fromLengths(lengths: Uint8Array): PrefixCode {
    const codes = new Uint32Array(lengths.length);
    let code = 0;
    for (let l = 1; l <= PrefixCode.MAX; l++) {
      for (let s = 0; s < lengths.length; s++) if (lengths[s] === l) {
        let r = 0;
        for (let i = 0; i < l; i++) if ((code >>> i) & 1) r |= 1 << (l - 1 - i);
        codes[s] = r;
        code++;
      }
      code <<= 1;
    }
    return new PrefixCode(lengths, codes);
  }
  write(w: BitWriter, symbol: number) {
    if (!this.lengths[symbol]) throw new RangeError("no code for " + symbol);
    w.write(this.codes[symbol], this.lengths[symbol]);
  }
  reader(): (r: BitReader) => number {
    const map = new Map<number, number>();
    this.lengths.forEach((l, s) => {
      if (l) map.set((l << 16) | this.codes[s], s);
  });
    return r => {
      let code = 0;
      for (let l = 1; l <= PrefixCode.MAX; l++) {
        code |= r.read(1) << (l - 1);
        const s = map.get((l << 16) | code);
        if (s !== undefined) return s;
      }
      throw new FormatError("no such code", r.at);
  };
  }
  save(w: BitWriter) {
    for (let i = 0; i < this.lengths.length; ) {
      const l = this.lengths[i];
      let n = 1;
      while (i + n < this.lengths.length && this.lengths[i + n] === l && n < 16) n++;
      w.write(l, 4).write(n - 1, 4);
      i += n;
    }
  }
  static load(r: BitReader, size: number): PrefixCode {
    const lengths = new Uint8Array(size);
    for (let i = 0; i < size; ) {
      const l = r.read(4), n = r.read(4) + 1;
      if (i + n > size) throw new FormatError("lengths overflow", r.at);
      lengths.fill(l, i, i + n);
      i += n;
    }
    return PrefixCode.fromLengths(lengths);
  }
}
export abstract class Codec {
  abstract readonly method: Method;
  abstract pack(bytes: Uint8Array): Uint8Array;
  abstract unpack(bytes: Uint8Array, size: number): Uint8Array;
  static readonly #all = new Map<Method, Codec>();
  static register(...codecs: Codec[]) {
    for (const c of codecs) Codec.#all.set(c.method, c);
  }
  static of(m: Method): Codec {
    const c = Codec.#all.get(m);
    if (!c) throw new RangeError("no codec " + m);
    return c;
  }
  static best(bytes: Uint8Array): {
    codec: Codec;
    packed: Uint8Array
  }
  {
    let best: {
      codec: Codec;
      packed: Uint8Array
  } | null = null;
    for (const codec of Codec.#all.values()) {
      const packed = codec.pack(bytes);
      if (!best || packed.length < best.packed.length) best = {
        codec, packed
    };
    }
    return best!;
  }
}
export class StoredCodec extends Codec {
  readonly method = Method.Stored;
  pack(b: Uint8Array) {
    return b.slice();
  }
  unpack(b: Uint8Array, size: number) {
    if (b.length !== size) throw new FormatError("size", b.length);
    return b.slice();
  }
}
export class RunsCodec extends Codec {
  readonly method = Method.Runs;
  pack(b: Uint8Array) {
    const out: number[] = [];
    for (let i = 0; i < b.length; ) {
      let n = 1;
      while (i + n < b.length && b[i + n] === b[i] && n < 255) n++;
      out.push(n, b[i]);
      i += n;
    }
    return Uint8Array.from(out);
  }
  unpack(b: Uint8Array, size: number) {
    const out = new Uint8Array(size);
    let at = 0;
    for (let i = 0; i + 1 < b.length; i += 2) {
      if (at + b[i] > size) throw new FormatError("run", i);
      out.fill(b[i + 1], at, at + b[i]);
      at += b[i];
    }
    if (at !== size) throw new FormatError("short", at);
    return out;
  }
}
export class PackedCodec extends Codec {
  readonly method = Method.Packed;
  tokens = 0;
  constructor(readonly window = 4096, readonly chain = 24) {
    super();
  }
  *#scan(b: Uint8Array): Generator<number | [length: number, distance: number]> {
    const heads = new Map<number, number>(), previous = new Int32Array(b.length).fill(-1);
    const key = (i: number) => (b[i] << 16) | (b[i + 1] << 8) | b[i + 2];
    const note = (i: number) => {
      if (i + 2 < b.length) {
        const k = key(i);
        previous[i] = heads.get(k) ?? -1;
        heads.set(k, i);
      }
  };
    for (let i = 0; i < b.length; ) {
      let best = 0, from = 0;
      if (i + 2 < b.length) {
        let at = heads.get(key(i)) ?? -1;
        for (let tries = 0; at >= 0 && i - at <= this.window && tries < this.chain; tries++,
          at = previous[at]) {
          let n = 3;
          while (n < 66 && i + n < b.length && b[at + n] === b[i + n]) n++;
          if (n > best) {
            best = n;
            from = i - at;
          }
        }
      }
      if (best >= 4) {
        yield [best, from];
        for (let k = 0; k < best; k++) note(i + k);
        i += best;
    } else {
        yield b[i];
        note(i++);
      }
    }
  }
  pack(b: Uint8Array): Uint8Array {
    const tokens = [...this.#scan(b)];
    this.tokens += tokens.length;
    const counts = new Uint32Array(257 + 63), distances = new Uint32Array(13);
    const slot = (d: number) => 31 - Math.clz32(d);
    for (const t of tokens) if (typeof t === "number") counts[t]++;
    else {
      counts[257 + t[0] - 4]++;
      distances[slot(t[1])]++;
    }
    counts[256] = 1;
    const codes = PrefixCode.fromCounts(counts), far = PrefixCode.fromCounts(distances);
    const w = new BitWriter();
    codes.save(w);
    far.save(w);
    for (const t of tokens) if (typeof t === "number") codes.write(w, t);
    else {
      codes.write(w, 257 + t[0] - 4);
      const s = slot(t[1]);
      far.write(w, s);
      w.write(t[1] - (1 << s), s);
    }
    codes.write(w, 256);
    return w.bytes();
  }
  unpack(b: Uint8Array, size: number): Uint8Array {
    const r = new BitReader(b);
    const symbol = PrefixCode.load(r, 320).reader(), distance = PrefixCode.load(r, 13).reader();
    const out = new Uint8Array(size);
    let at = 0;
    for (;;) {
      const s = symbol(r);
      if (s === 256) break;
      if (s < 256) {
        if (at >= size) throw new FormatError("overflow", at);
        out[at++] = s;
        continue;
      }
      const length = s - 257 + 4, k = distance(r), d = (1 << k) + r.read(k);
      if (d > at || at + length > size) throw new FormatError("bad copy", at);
      for (let i = 0; i < length; i++, at++) out[at] = out[at - d];
    }
    if (at !== size) throw new FormatError("short", at);
    return out;
  }
}
export class Folder {
  readonly folders = new Map<string, Folder>();
  readonly files = new Map<string, number>();
  constructor(readonly name: string) {
  }
  at(parts: readonly string[], make = false): Folder | null {
    let f: Folder = this;
    for (const p of parts) {
      let next = f.folders.get(p);
      if (!next) {
        if (!make) return null;
        f.folders.set(p, (next = new Folder(p)));
      }
      f = next;
    }
    return f;
  }
  *walk(prefix = ""): Generator<[string, number]> {
    for (const [n, i] of [...this.files].sort(([a],
      [b]) => (a < b ? -1 : 1))) yield [prefix + n, i];
    for (const [n, f] of [...this.folders].sort(([a],
      [b]) => (a < b ? -1 : 1))) yield* f.walk(prefix + n + "/");
  }
  get count(): number {
    let n = this.files.size;
    for (const f of this.folders.values()) n += f.count;
    return n;
  }
}
export class Archive {
  static readonly MAGIC = 0x4152;
  readonly #entries: {
    info: EntryInfo;
    data: Uint8Array
}[] = [];
  readonly root = new Folder("");
  constructor(readonly title = "") {
  }
  static #parts(path: string): string[] {
    const parts = path.split("/").filter(p => p && p !== ".");
    if (!parts.length ||
      parts.includes("..")) throw new RangeError("bad path " + JSON.stringify(path));
    return parts;
  }
  add(path: string, content: Uint8Array | string, time = 0): EntryInfo {
    const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
    const parts = Archive.#parts(path), name = parts.pop()!;
    const folder = this.root.at(parts, true)!;
    if (folder.folders.has(name)) throw new TypeError(path + " is a folder");
    const {
      codec, packed
  } = Codec.best(bytes);
    const info: EntryInfo = {
      path: [...parts, name].join("/"), size: bytes.length, packed: packed.length,
        method: codec.method, sum: Sum.crc(bytes), time
  };
    const old = folder.files.get(name);
    if (old !== undefined) this.#entries[old] = {
      info, data: packed
  };
    else {
      folder.files.set(name, this.#entries.length);
      this.#entries.push({ info, data: packed });
    }
    return info;
  }
  #find(path: string) {
    const parts = Archive.#parts(path), name = parts.pop()!;
    const i = this.root.at(parts)?.files.get(name);
    if (i === undefined) throw new ReferenceError("no entry " + path);
    return this.#entries[i];
  }
  read(path: string): Uint8Array {
    const {
      info, data
  } = this.#find(path);
    const out = Codec.of(info.method).unpack(data, info.size);
    if (Sum.crc(out) !== info.sum) throw new FormatError("sum of " + path, 0);
    return out;
  }
  text(path: string) {
    return new TextDecoder().decode(this.read(path));
  }
  remove(path: string) {
    const parts = Archive.#parts(path), name = parts.pop()!;
    return this.root.at(parts)?.files.delete(name) ?? false;
  }
  *list(prefix = ""): Generator<EntryInfo> {
    for (const [path,
      i] of this.root.walk()) if (path.startsWith(prefix)) yield this.#entries[i].info;
  }
  get sizes(): [number, number] {
    let a = 0, b = 0;
    for (const e of this.list()) {
      a += e.size;
      b += e.packed;
    }
    return [a, b];
  }
  save(): Uint8Array {
    const w = new BitWriter();
    w.write(Archive.MAGIC, 16).write(this.root.count, 16);
    const text = (s: string) => {
      const b = new TextEncoder().encode(s);
      w.write(b.length, 12);
      for (const x of b) w.write(x, 8);
  };
    text(this.title);
    for (const [path, i] of this.root.walk()) {
      const {
        info, data
    } = this.#entries[i];
      text(path);
      w.write(info.size, 24).write(data.length, 24).write(info.method, 2).write(info.sum,
        32).write(info.time, 20).align();
      for (const x of data) w.write(x, 8);
    }
    const body = w.align().bytes();
    const tail = new BitWriter().write(Sum.adler(body), 32).bytes();
    const out = new Uint8Array(body.length + 4);
    out.set(body);
    out.set(tail, body.length);
    return out;
  }
  static load(bytes: Uint8Array): Archive {
    if (bytes.length < 8) throw new FormatError("too short", bytes.length);
    const body = bytes.subarray(0, -4);
    const want = new BitReader(bytes, bytes.length - 4).read(32);
    const r = new BitReader(body);
    if (r.read(16) !== Archive.MAGIC) throw new FormatError("not an archive", 0);
    if (Sum.adler(body) !== want) throw new FormatError("sum", bytes.length - 4);
    const count = r.read(16);
    const text = () => {
      const n = r.read(12), b = new Uint8Array(n);
      for (let i = 0; i < n; i++) b[i] = r.read(8);
      return new TextDecoder().decode(b);
  };
    const a = new Archive(text());
    for (let i = 0; i < count; i++) {
      const path = text(), size = r.read(24), packed = r.read(24),
        method = r.read(2) as Method, sum = r.read(32), time = r.read(20);
      r.align();
      const data = body.slice(r.at, r.at + packed);
      if (data.length < packed) throw new FormatError("data ends", r.at);
      r.at += packed;
      const parts = Archive.#parts(path), name = parts.pop()!;
      a.root.at(parts, true)!.files.set(name, a.#entries.length);
      a.#entries.push({ info: { path, size, packed, method, sum, time }, data });
    }
    return a;
  }
}
Codec.register(new StoredCodec(), new RunsCodec(), new PackedCodec());
