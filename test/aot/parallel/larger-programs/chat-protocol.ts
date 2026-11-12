// A chat server and its clients on a simulated network: frames, a codec with lengths and sums, sequence numbers, windows, losses and repeats, rooms, rights, commands, history, statistics
type Command = {
  cmd: "login";
  name: string;
  secret: string
} | {
  cmd: "join";
  room: string
} | {
  cmd: "leave";
  room: string
} | {
  cmd: "say";
  room: string;
  text: string
} | {
  cmd: "whisper";
  to: string;
  text: string
} | {
  cmd: "list";
  room?: string
} | {
  cmd: "kick";
  room: string;
  who: string
} | {
  cmd: "history";
  room: string;
  last: number
} | {
  cmd: "topic";
  room: string;
  topic: string
};
type Reply = {
  re: "ok";
  of: string;
  data?: unknown
} | {
  re: "error";
  of: string;
  code: ErrorCode;
  why: string
} | {
  re: "event";
  kind: "joined" | "left" | "said" | "whispered" | "kicked" | "topic";
  room?: string;
  who: string;
  text?: string
};
enum ErrorCode {
  BadFrame = 1, NotLoggedIn, NoRoom, NoRight, NoUser, TooLong, Taken
}
class ProtocolError extends Error {
  constructor(readonly code: ErrorCode, message: string) {
    super(message);
    this.name = "ProtocolError";
  }
}
class Random {
  #s: number;
  constructor(seed: number) {
    this.#s = seed;
  }
  next() {
    this.#s = (this.#s * 48271) % 2147483647;
    return this.#s / 2147483647;
  }
  int(n: number) {
    return Math.floor(this.next() * n);
  }
}
namespace Codec {
  export function encode(v: unknown): Uint8Array {
    const out: number[] = [];
    const text = (s: string) => {
      const b = new TextEncoder().encode(s);
      size(b.length);
      for (const x of b) out.push(x);
  };
    const size = (n: number) => {
      while (n > 127) {
        out.push((n & 127) | 128);
        n >>>= 7;
      }
      out.push(n);
  };
    const write = (x: unknown): void => {
      if (x === null || x === undefined) out.push(0);
      else if (x === true) out.push(1);
      else if (x === false) out.push(2);
      else if (typeof x === "number") {
        if (Number.isInteger(x) && x >= 0 && x < 2 ** 28) {
          out.push(3);
          size(x);
      } else {
          out.push(4);
          out.push(...new Uint8Array(Float64Array.of(x).buffer));
        }
    } else if (typeof x === "string") {
        out.push(5);
        text(x);
    } else if (Array.isArray(x)) {
        out.push(6);
        size(x.length);
        x.forEach(write);
    } else {
        const e = Object.entries(x as object).filter(([, y]) => y !== undefined);
        out.push(7);
        size(e.length);
        for (const [k, y] of e) {
          text(k);
          write(y);
        }
      }
  };
    write(v);
    return Uint8Array.from(out);
  }
  export function decode(bytes: Uint8Array): unknown {
    let i = 0;
    const need = (n: number) => {
      if (i + n > bytes.length) throw new ProtocolError(ErrorCode.BadFrame, "value ends");
  };
    const size = () => {
      let n = 0, shift = 0, b: number;
      do {
        need(1);
        b = bytes[i++];
        n |= (b & 127) << shift;
        shift += 7;
    } while (b & 128);
      return n;
  };
    const text = () => {
      const n = size();
      need(n);
      const s = new TextDecoder().decode(bytes.subarray(i, i + n));
      i += n;
      return s;
  };
    const read = (): unknown => {
      need(1);
      switch (bytes[i++]) {
        case 0: return null;
        case 1: return true;
        case 2: return false;
        case 3: return size();
        case 4: {
          need(8);
          const v = new Float64Array(bytes.slice(i, i + 8).buffer)[0];
          i += 8;
          return v;
        }
        case 5: return text();
        case 6: {
          const n = size(), list: unknown[] = [];
          for (let k = 0; k < n; k++) list.push(read());
          return list;
        }
        case 7: {
          const n = size(), o: Record<string, unknown> = {
        };
          for (let k = 0; k < n; k++) {
            const key = text();
            o[key] = read();
          }
          return o;
        }
        default: throw new ProtocolError(ErrorCode.BadFrame, "bad tag " + bytes[i - 1]);
      }
  };
    const v = read();
    if (i !== bytes.length) throw new ProtocolError(ErrorCode.BadFrame, "more bytes");
    return v;
  }
}
class Frame {
  static readonly HEAD = 9;
  constructor(readonly seq: number, readonly ack: number, readonly payload: Uint8Array) {
  }
  static sum(head: Uint8Array, b: Uint8Array): number {
    let a = 1, c = 0;
    for (const part of [head, b]) for (const x of part) {
      a = (a + x) % 251;
      c = (c + a) % 251;
    }
    return (c << 8) | a;
  }
  bytes(): Uint8Array {
    const out = new Uint8Array(Frame.HEAD + this.payload.length), v = new DataView(out.buffer);
    out[0] = 0xc5;
    v.setUint16(1, this.seq);
    v.setUint16(3, this.ack);
    v.setUint16(5, this.payload.length);
    v.setUint16(7, Frame.sum(out.subarray(1, 7), this.payload));
    out.set(this.payload, Frame.HEAD);
    return out;
  }
  static parse(bytes: Uint8Array): Frame {
    if (bytes.length < Frame.HEAD ||
      bytes[0] !== 0xc5) throw new ProtocolError(ErrorCode.BadFrame, "not a frame");
    const v = new DataView(bytes.buffer, bytes.byteOffset);
    const payload = bytes.slice(Frame.HEAD);
    if (v.getUint16(5) !== payload.length) throw new ProtocolError(ErrorCode.BadFrame,
      "bad length");
    if (v.getUint16(7) !== Frame.sum(bytes.subarray(1, 7),
      payload)) throw new ProtocolError(ErrorCode.BadFrame, "bad sum");
    return new Frame(v.getUint16(1), v.getUint16(3), payload);
  }
}
interface Packet {
  at: number;
  seq: number;
  to: Endpoint;
  bytes: Uint8Array
}
class Network {
  now = 0;
  sent = 0;
  lost = 0;
  broken = 0;
  readonly #packets: Packet[] = [];
  #seq = 0;
  readonly endpoints: Endpoint[] = [];
  constructor(readonly random: Random, readonly loss: number, readonly noise: number) {
  }
  send(to: Endpoint, bytes: Uint8Array) {
    this.sent++;
    if (this.random.next() < this.loss) {
      this.lost++;
      return;
    }
    let b = bytes;
    if (this.random.next() < this.noise) {
      b = bytes.slice();
      b[this.random.int(b.length)] ^= 1 << this.random.int(8);
      this.broken++;
    }
    const p: Packet = {
      at: this.now + 1 + this.random.int(6), seq: this.#seq++, to, bytes: b
  };
    let i = this.#packets.length;
    while (i > 0 && (this.#packets[i - 1].at > p.at || (this.#packets[i - 1].at === p.at &&
      this.#packets[i - 1].seq > p.seq))) i--;
    this.#packets.splice(i, 0, p);
  }
  tick(): boolean {
    this.now++;
    while (this.#packets.length && this.#packets[0].at <= this.now) {
      const p = this.#packets.shift()!;
      p.to.arrive(p.bytes);
    }
    for (const e of this.endpoints) e.tick();
    return this.#packets.length > 0 || this.endpoints.some(e => e.busy);
  }
}
class Endpoint {
  peer!: Endpoint;
  #nextSeq = 1;
  #expected = 1;
  readonly #unacked = new Map<number, {
    bytes: Uint8Array;
    payload: Uint8Array;
    at: number;
    tries: number
  }
  >();
  readonly #early = new Map<number, Uint8Array>();
  readonly #waiting: Uint8Array[] = [];
  repeats = 0;
  duplicates = 0;
  bad = 0;
  static readonly WINDOW = 8;
  static readonly TIMEOUT = 16;
  constructor(readonly net: Network, readonly deliver: (v: any) => void) {
    net.endpoints.push(this);
  }
  get busy() {
    return this.#unacked.size > 0 || this.#waiting.length > 0;
  }
  send(v: unknown) {
    this.#waiting.push(Codec.encode(v));
    this.#pump();
  }
  #pump() {
    while (this.#waiting.length && this.#unacked.size < Endpoint.WINDOW) {
      const payload = this.#waiting.shift()!, seq = this.#nextSeq++;
      const bytes = new Frame(seq, this.#expected - 1, payload).bytes();
      this.#unacked.set(seq, { bytes, payload, at: this.net.now, tries: 1 });
      this.net.send(this.peer, bytes);
    }
  }
  arrive(bytes: Uint8Array) {
    let f: Frame;
    try {
      f = Frame.parse(bytes);
  } catch (e) {
      if (!(e instanceof ProtocolError)) throw e;
      this.bad++;
      return;
    }
    for (const s of [...this.#unacked.keys()]) if (s <= f.ack) this.#unacked.delete(s);
    if (f.seq) {
      if (f.seq < this.#expected || this.#early.has(f.seq)) this.duplicates++;
      else this.#early.set(f.seq, f.payload);
      while (this.#early.has(this.#expected)) {
        const p = this.#early.get(this.#expected)!;
        this.#early.delete(this.#expected++);
        this.deliver(Codec.decode(p));
      }
      this.net.send(this.peer, new Frame(0, this.#expected - 1, new Uint8Array(0)).bytes());
    }
    this.#pump();
  }
  tick() {
    for (const [seq,
      u] of this.#unacked) if (this.net.now - u.at >= Endpoint.TIMEOUT * Math.min(4, u.tries)) {
      u.at = this.net.now;
      u.tries++;
      this.repeats++;
      this.net.send(this.peer, new Frame(seq, this.#expected - 1, u.payload).bytes());
    }
  }
  static pair(net: Network, a: (v: any) => void, b: (v: any) => void): [Endpoint, Endpoint] {
    const x = new Endpoint(net, a), y = new Endpoint(net, b);
    x.peer = y;
    y.peer = x;
    return [x, y];
  }
}
class Room {
  readonly members = new Map<string, Session>();
  readonly history: {
    who: string;
    text: string
}[] = [];
  topic = "";
  owner: string;
  constructor(readonly name: string, owner: string) {
    this.owner = owner;
  }
  broadcast(r: Reply, except?: Session) {
    for (const s of this.members.values()) if (s !== except) s.reply(r);
  }
  get names() {
    return [...this.members.keys()].sort();
  }
}
class Session {
  name: string | null = null;
  constructor(readonly server: Server, readonly endpoint: () => Endpoint) {
  }
  reply(r: Reply) {
    this.endpoint().send(r);
  }
  receive(c: Command) {
    try {
      this.server.handle(this, c);
  } catch (e) {
      if (!(e instanceof ProtocolError)) throw e;
      this.server.errors[ErrorCode[e.code]] = (this.server.errors[ErrorCode[e.code]] ?? 0) + 1;
      this.reply({ re: "error", of: c.cmd, code: e.code, why: e.message });
    }
  }
}
class Server {
  readonly rooms = new Map<string, Room>();
  readonly users = new Map<string, Session>();
  readonly errors: Record<string, number> = {
};
  handled = 0;
  #room(name: string): Room {
    const r = this.rooms.get(name);
    if (!r) throw new ProtocolError(ErrorCode.NoRoom, "no room " + name);
    return r;
  }
  #member(s: Session, room: string): Room {
    const r = this.#room(room);
    if (!r.members.has(s.name!)) throw new ProtocolError(ErrorCode.NoRight, "not in " + room);
    return r;
  }
  #leave(r: Room, who: string) {
    r.members.delete(who);
    if (!r.members.size) this.rooms.delete(r.name);
    else if (r.owner === who) r.owner = r.names[0];
  }
  handle(s: Session, c: Command): void {
    this.handled++;
    if (c.cmd !== "login" && !s.name) throw new ProtocolError(ErrorCode.NotLoggedIn,
      "login first");
    const ok = (data?: unknown) => s.reply({ re: "ok", of: c.cmd, data });
    switch (c.cmd) {
      case "login": if (c.secret !== c.name.split("").reverse().join("")) throw new ProtocolError(ErrorCode.NoRight,
        "wrong secret");
      if (this.users.has(c.name)) throw new ProtocolError(ErrorCode.Taken, c.name + " is here");
      s.name = c.name;
      this.users.set(c.name, s);
      ok();
      break;
      case "join": {
        let r = this.rooms.get(c.room);
        if (!r) this.rooms.set(c.room, (r = new Room(c.room, s.name!)));
        r.members.set(s.name!, s);
        ok({ names: r.names, topic: r.topic });
        r.broadcast({ re: "event", kind: "joined", room: c.room, who: s.name! }, s);
        break;
      }
      case "leave": {
        const r = this.#member(s, c.room);
        this.#leave(r, s.name!);
        ok();
        r.broadcast({ re: "event", kind: "left", room: c.room, who: s.name! });
        break;
      }
      case "say": {
        const r = this.#member(s, c.room);
        if (c.text.length > 60) throw new ProtocolError(ErrorCode.TooLong,
          "too long: " + c.text.length);
        r.history.push({ who: s.name!, text: c.text });
        if (r.history.length > 20) r.history.shift();
        r.broadcast({ re: "event", kind: "said", room: c.room, who: s.name!, text: c.text });
        break;
      }
      case "whisper": {
        const u = this.users.get(c.to);
        if (!u) throw new ProtocolError(ErrorCode.NoUser, "no user " + c.to);
        u.reply({ re: "event", kind: "whispered", who: s.name!, text: c.text });
        ok();
        break;
      }
      case "list": ok(c.room ? this.#room(c.room).names : [...this.rooms.keys()].sort());
      break;
      case "kick": {
        const r = this.#member(s, c.room);
        if (r.owner !== s.name) throw new ProtocolError(ErrorCode.NoRight, "not the owner");
        const u = r.members.get(c.who);
        if (!u) throw new ProtocolError(ErrorCode.NoUser, c.who + " is not here");
        r.broadcast({ re: "event", kind: "kicked", room: c.room, who: c.who });
        this.#leave(r, c.who);
        break;
      }
      case "history": ok(this.#member(s, c.room).history.slice(-c.last));
      break;
      case "topic": {
        const r = this.#member(s, c.room);
        r.topic = c.topic;
        r.broadcast({ re: "event", kind: "topic", room: c.room, who: s.name!, text: c.topic });
        break;
      }
      default: {
        const never: never = c;
        throw new ProtocolError(ErrorCode.BadFrame, JSON.stringify(never));
      }
    }
  }
}
class Client {
  readonly endpoint: Endpoint;
  readonly counts: Record<string, number> = {
};
  readonly log: string[] = [];
  characters = 0;
  constructor(readonly name: string, net: Network, server: Server) {
    let remote!: Endpoint;
    const session = new Session(server, () => remote);
    const [mine, theirs] = Endpoint.pair(net, (r: Reply) => this.#got(r),
      (c: Command) => session.receive(c));
    this.endpoint = mine;
    remote = theirs;
  }
  #got(r: Reply) {
    const key = r.re === "event" ? r.kind : r.re;
    this.counts[key] = (this.counts[key] ?? 0) + 1;
    this.characters += JSON.stringify(r).length;
    if (this.log.length < 400) this.log.push(r.re === "event" ? `${r.kind} ${r.room ?? ""} ${r.who} ${r.text ?? ""}` : r.re === "error" ? `error ${ErrorCode[r.code]} ${r.why}` : `ok ${r.of} ${r.data === null || r.data === undefined ? "" : JSON.stringify(r.data)}`);
  }
  send(c: Command) {
    this.endpoint.send(c);
  }
}
for (const [seed, loss, noise] of [[7, 0, 0], [11, 0.12, 0.05], [13, 0.3, 0.1]] as const) {
  const random = new Random(seed), net = new Network(new Random(seed * 3), loss, noise),
    server = new Server();
  const clients = ["ann", "bob", "cid", "dot", "eve"].map(n => new Client(n, net, server));
  for (const c of clients) {
    c.send({ cmd: "list" });
    c.send({ cmd: "login", name: c.name,
      secret: c.name === "eve" ? "x" : c.name.split("").reverse().join("") });
    c.send({ cmd: "join", room: "lobby" });
} while (net.tick());
  clients[4].send({ cmd: "login", name: "eve", secret: "eve" });
  while (net.tick());
  for (let i = 0; i < 400; i++) {
    const c = clients[random.int(5)], room = ["lobby", "den", "attic"][random.int(3)];
    switch (random.int(9)) {
      case 0: c.send({ cmd: "join", room });
      break;
      case 1: c.send({ cmd: "leave", room });
      break;
      case 2: c.send({ cmd: "whisper", to: ["ann", "bob", "zed"][random.int(3)],
        text: "psst " + i });
      break;
      case 3: c.send({ cmd: "list", ...(random.int(2) ? { room } : {}) });
      break;
      case 4: c.send({ cmd: "kick", room, who: clients[random.int(5)].name });
      break;
      case 5: c.send({ cmd: "history", room, last: random.int(4) });
      break;
      case 6: c.send({ cmd: "topic", room, topic: "topic " + i + " é" });
      break;
      default: c.send({ cmd: "say", room,
        text: "text " + i + " " + "x".repeat(random.int(70)) });
    }
    if (i % 5 === 0) for (let t = 0; t < 10; t++) net.tick();
} while (net.tick());
  console.log(seed, net.now, net.sent, net.lost, net.broken, server.handled,
    JSON.stringify(Object.entries(server.errors).sort()));
  console.log([...server.rooms.values()].map(r => `${r.name}:${r.owner}:${r.names.join("+")}:${r.topic}:${r.history.length}`).sort().join(" "));
  console.log(clients.map(c => `${c.name} ${Object.values(c.counts).reduce((a, b) => a + b, 0)} ${c.characters}`).join("; "));
  if (seed === 7) console.log(clients[0].log.slice(0, 6).join(" | "));
  else console.log(net.endpoints.some(e => e.repeats > 0), net.endpoints.reduce((s,
    e) => s + e.duplicates, 0) > 0, net.endpoints.reduce((s, e) => s + e.bad, 0));
}
const values: unknown[] = [null, true, 0, 127, 128, 2 ** 28, -1, 1.5, "", "é😀", [], [1, [2]],
  { a: { b: [null, false] }, "": 1 }];
console.log(values.every(v => JSON.stringify(Codec.decode(Codec.encode(v))) === JSON.stringify(v)),
  values.map(v => Codec.encode(v).length).join());
for (const bad of [Uint8Array.of(9), Uint8Array.of(5, 4, 65), Uint8Array.of(0, 0),
  Uint8Array.of(4, 1)]) try {
  Codec.decode(bad);
} catch (e) {
  console.log((e as Error).name, (e as Error).message);
}
const frame = new Frame(5, 3, Uint8Array.of(1, 2, 3)).bytes();
console.log(Frame.parse(frame).seq, Frame.parse(frame).payload.join());
for (const [i, v] of [[0, 1], [6, 9], [10, 7]]) try {
  const b = frame.slice();
  b[i] = v;
  Frame.parse(b);
} catch (e) {
  console.log((e as Error).message);
}
