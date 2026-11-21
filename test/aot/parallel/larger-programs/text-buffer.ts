// The buffer of an editor: pieces of two texts, lines, cursors, selections, search, undo in groups, markers that move
enum Source {
  Original, Added
}
interface Piece {
  source: Source;
  start: number;
  length: number;
  breaks: number
}
type Edit = {
  at: number;
  removed: string;
  inserted: string
};
interface Position {
  line: number;
  column: number
}
class PieceTable {
  readonly #texts: [string, string];
  #pieces: Piece[];
  #length: number;
  constructor(text = "") {
    this.#texts = [text, ""];
    this.#pieces = text ? [{ source: Source.Original, start: 0, length: text.length,
      breaks: PieceTable.breaks(text) }] : [];
    this.#length = text.length;
  }
  static breaks(text: string): number {
    let n = 0;
    for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
    return n;
  }
  get length() {
    return this.#length;
  }
  get pieces() {
    return this.#pieces.length;
  }
  get lines() {
    return this.#pieces.reduce((n, p) => n + p.breaks, 1);
  }
  #text(p: Piece, from = 0, to = p.length) {
    return this.#texts[p.source].slice(p.start + from, p.start + to);
  }
  #find(at: number): [number, number] {
    let i = 0;
    while (i < this.#pieces.length &&
      at > this.#pieces[i].length) at -= this.#pieces[i++].length;
    return [i, at];
  }
  #make(p: Piece, from: number, to: number): Piece {
    return {
      source: p.source, start: p.start + from, length: to - from,
        breaks: PieceTable.breaks(this.#text(p, from, to))
  };
  }
  insert(at: number, text: string) {
    if (at < 0 || at > this.#length) throw new RangeError(`insert at ${at} of ${this.#length}`);
    if (!text) return;
    const start = this.#texts[1].length;
    this.#texts[1] += text;
    const made: Piece = {
      source: Source.Added, start, length: text.length, breaks: PieceTable.breaks(text)
  };
    this.#length += text.length;
    const [i, rest] = this.#find(at);
    const p = this.#pieces[i];
    if (!p) this.#pieces.push(made);
    else if (rest === p.length) {
      if (p.source === Source.Added && p.start + p.length === start) this.#pieces[i] = {
        ...p, length: p.length + text.length, breaks: p.breaks + made.breaks
    };
      else this.#pieces.splice(i + 1, 0, made);
  } else if (rest === 0) this.#pieces.splice(i, 0, made);
    else this.#pieces.splice(i, 1, this.#make(p, 0, rest), made, this.#make(p, rest, p.length));
  }
  remove(at: number, count: number): string {
    if (at < 0 || count < 0 ||
      at + count > this.#length) throw new RangeError(`remove ${count} at ${at} of ${this.#length}`);
    const gone = this.slice(at, at + count);
    let pos = 0;
    const out: Piece[] = [];
    for (const p of this.#pieces) {
      const from = Math.max(0, Math.min(p.length, at - pos)), to = Math.max(0,
        Math.min(p.length, at + count - pos));
      if (from >= to) out.push(p);
      else {
        if (from > 0) out.push(this.#make(p, 0, from));
        if (to < p.length) out.push(this.#make(p, to, p.length));
      }
      pos += p.length;
    }
    this.#pieces = out;
    this.#length -= count;
    return gone;
  }
  slice(from = 0, to = this.#length): string {
    let out = "", pos = 0;
    for (const p of this.#pieces) {
      if (pos >= to) break;
      const a = Math.max(0, from - pos), b = Math.min(p.length, to - pos);
      if (a < b) out += this.#text(p, a, b);
      pos += p.length;
    }
    return out;
  }
  offset({ line, column }: Position): number {
    let pos = 0, left = line;
    for (const p of this.#pieces) {
      if (left > p.breaks) {
        left -= p.breaks;
        pos += p.length;
        continue;
      }
      const text = this.#text(p);
      let i = 0;
      while (left > 0) {
        const n = text.indexOf("\n", i);
        if (n < 0) break;
        i = n + 1;
        left--;
      }
      if (left === 0) return Math.min(pos + i + column, this.#length);
      pos += p.length;
    }
    return this.#length;
  }
  position(at: number): Position {
    let line = 0, start = 0, pos = 0;
    for (const p of this.#pieces) {
      const take = Math.min(p.length, at - pos);
      const text = this.#text(p, 0, take);
      for (let n = text.indexOf("\n"); n >= 0; n = text.indexOf("\n", n + 1)) {
        line++;
        start = pos + n + 1;
      }
      pos += take;
      if (pos >= at) break;
    }
    return {
      line, column: at - start
  };
  }
}
class Marker {
  constructor(public at: number, readonly sticky: "left" | "right" = "left",
    readonly label = "") {
  }
  shift(e: Edit) {
    if (e.at < this.at || (e.at === this.at && this.sticky === "right" && !e.removed)) {
      const gone = Math.min(e.removed.length, Math.max(0, this.at - e.at));
      this.at += e.inserted.length - gone;
    }
  }
}
class History {
  readonly #done: Edit[][] = [];
  readonly #undone: Edit[][] = [];
  #group: Edit[] | null = null;
  #last = -1;
  record(e: Edit, tick: number) {
    this.#undone.length = 0;
    if (this.#group) {
      this.#group.push(e);
      return;
    }
    const top = this.#done.at(-1), before = top?.at(-1);
    if (before && tick === this.#last + 1 && !e.removed && !before.removed &&
      before.at + before.inserted.length === e.at && e.inserted.length === 1 &&
      e.inserted !== "\n") before.inserted += e.inserted;
    else this.#done.push([e]);
    this.#last = tick;
  }
  group<T>(work: () => T): T {
    if (this.#group) return work();
    this.#group = [];
    try {
      return work();
  } finally {
      if (this.#group.length) this.#done.push(this.#group);
      this.#group = null;
      this.#last = -2;
    }
  }
  undo(apply: (e: Edit) => void): boolean {
    const g = this.#done.pop();
    if (!g) return false;
    for (let i = g.length - 1; i >= 0; i--) apply({ at: g[i].at, removed: g[i].inserted,
      inserted: g[i].removed });
    this.#undone.push(g);
    this.#last = -2;
    return true;
  }
  redo(apply: (e: Edit) => void): boolean {
    const g = this.#undone.pop();
    if (!g) return false;
    for (const e of g) apply(e);
    this.#done.push(g);
    return true;
  }
  get depth() {
    return [this.#done.length, this.#undone.length] as const;
  }
}
class Editor {
  readonly table: PieceTable;
  readonly history = new History();
  readonly markers: Marker[] = [];
  cursors: {
    anchor: Marker;
    head: Marker
}[] = [];
  #tick = 0;
  edits = 0;
  constructor(text: string) {
    this.table = new PieceTable(text);
    this.select([0, 0]);
  }
  get text() {
    return this.table.slice();
  }
  select(...ranges: [number, number][]) {
    this.cursors = ranges.map(([a, h]) => ({ anchor: new Marker(a, "right"),
      head: new Marker(h, "right") }));
  }
  #apply = (e: Edit) => {
    if (e.removed) this.table.remove(e.at, e.removed.length);
    if (e.inserted) this.table.insert(e.at, e.inserted);
    this.edits++;
    for (const m of this.markers) m.shift(e);
    for (const c of this.cursors) {
      c.anchor.shift(e);
      c.head.shift(e);
    }
};
  replace(from: number, to: number, inserted: string) {
    const e: Edit = {
      at: from, removed: this.table.slice(from, to), inserted
  };
    if (!e.removed && !inserted) return;
    this.#apply(e);
    this.history.record(e, ++this.#tick);
  }
  type(text: string) {
    const work = () => {
      for (const c of [...this.cursors].sort((a, b) => b.head.at - a.head.at)) {
        const from = Math.min(c.anchor.at, c.head.at), to = Math.max(c.anchor.at, c.head.at);
        this.replace(from, to, text);
        c.anchor.at = c.head.at;
      }
  };
    if (this.cursors.length > 1) this.history.group(work);
    else work();
  }
  backspace() {
    this.history.group(() => {
      for (const c of this.cursors) {
        const from = Math.min(c.anchor.at, c.head.at), to = Math.max(c.anchor.at, c.head.at);
        if (from === to) {
          if (from > 0) this.replace(from - 1, from, "");
      } else this.replace(from, to, "");
      }
  });
  }
  find(what: RegExp | string): [number, number][] {
    const re = typeof what === "string" ? new RegExp(what.replace(/[.*+?^${}()|[\]\\]/g,
      "\\$&"), "g") : new RegExp(what.source,
      what.flags.includes("g") ? what.flags : what.flags + "g");
    return [...this.text.matchAll(re)].filter(m => m[0]).map(m => [m.index!,
      m.index! + m[0].length]);
  }
  replaceAll(what: RegExp, by: string | ((...all: string[]) => string)): number {
    const text = this.text;
    const found = this.find(what);
    this.history.group(() => {
      for (let i = found.length - 1; i >= 0; i--) {
        const [a, b] = found[i];
        this.replace(a, b, text.slice(a, b).replace(new RegExp(what.source,
          what.flags.replace("g", "")), by as string));
      }
  });
    return found.length;
  }
  moveLines(from: number, count: number, by: number) {
    this.history.group(() => {
      const a = this.table.offset({ line: from, column: 0 }),
        b = this.table.offset({ line: from + count, column: 0 });
      let text = this.table.slice(a, b);
      if (!text.endsWith("\n")) text += "\n";
      this.replace(a, b, "");
      const to = this.table.offset({ line: Math.max(0, from + by), column: 0 });
      this.replace(to, to, text);
  });
  }
  undo() {
    return this.history.undo(this.#apply);
  }
  redo() {
    return this.history.redo(this.#apply);
  }
}
const editor = new Editor(Array.from({ length: 200 }, (_,
  i) => `line ${i} of ${"abc".repeat(i % 4)}`).join("\n"));
const marker = new Marker(500, "left", "kept");
editor.markers.push(marker);
let plain = editor.text, seed = 11, checks = 0;
const random = (n: number) => (seed = (seed * 48271) % 2147483647) % n;
for (let i = 0; i < 1800; i++) {
  const at = random(plain.length + 1);
  switch (i % 9) {
    case 0: case 1: case 2: editor.select([at, at]);
    for (const c of "typed" + (i % 7)) {
      editor.type(c);
    }
    plain = plain.slice(0, at) + "typed" + (i % 7) + plain.slice(at);
    break;
    case 3: {
      const to = Math.min(plain.length, at + 12);
      editor.replace(at, to, "R" + i + "\n");
      plain = plain.slice(0, at) + "R" + i + "\n" + plain.slice(to);
      break;
    }
    case 4: editor.select([at, at]);
    editor.backspace();
    plain = at > 0 ? plain.slice(0, at - 1) + plain.slice(at) : plain;
    break;
    case 5: {
      const p = editor.table.position(at);
      if (editor.table.offset(p) !== at) throw new Error("position " + at);
      checks += p.line + p.column;
      break;
    }
    case 6: if (editor.undo()) {
      editor.redo();
    }
    break;
    case 7: checks += editor.table.lines;
    break;
    default: checks += editor.table.slice(at, at + 5).length;
  }
  if (i % 300 === 299) console.log(i, editor.text === plain, plain.length, editor.table.pieces,
    marker.at, checks, editor.history.depth.join("/"));
}
editor.select([0, 0], [100, 104], [200, 200]);
editor.type("MULTI");
console.log(editor.cursors.map(c => c.head.at).join(), editor.text.slice(0, 12).replace(/\n/g,
  "|"));
console.log(editor.replaceAll(/typed(\d)/, (all, d) => "<" + d + ">"),
  editor.find("line 1").length, editor.find(/^R\d+$/m).length);
editor.moveLines(3, 2, -2);
console.log(JSON.stringify(editor.text.split("\n").slice(0, 6)));
let undone = 0;
while (editor.undo()) undone++;
console.log(undone, editor.text === Array.from({ length: 200 }, (_,
  i) => `line ${i} of ${"abc".repeat(i % 4)}`).join("\n"), editor.edits);
while (editor.redo());
console.log(editor.history.depth.join(), editor.table.length);
for (const bad of [() => editor.table.insert(-1, "x"), () => editor.table.remove(0, 1e9)]) try {
  bad();
} catch (e) {
  console.log((e as Error).message);
}
