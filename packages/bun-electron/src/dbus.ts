// Minimal D-Bus client for the session bus — enough to own a name, export an
// object's properties, call methods, and emit signals. Used to implement the
// Linux system tray via the StatusNotifierItem spec. Little-endian only.
//
// This is a focused implementation (not a general D-Bus library): it marshals
// the handful of type signatures the tray needs.

import { connect, type Socket } from "node:net";
import { userInfo } from "node:os";

type Variant = { signature: string; value: unknown };

export function variant(signature: string, value: unknown): Variant {
  return { signature, value };
}

// ---- Marshalling -----------------------------------------------------------

class Writer {
  private buf: number[] = [];

  get length(): number {
    return this.buf.length;
  }

  bytes(): Buffer {
    return Buffer.from(this.buf);
  }

  align(n: number): void {
    while (this.buf.length % n !== 0) this.buf.push(0);
  }

  byte(v: number): void {
    this.buf.push(v & 0xff);
  }

  uint16(v: number): void {
    this.align(2);
    this.buf.push(v & 0xff, (v >> 8) & 0xff);
  }

  uint32(v: number): void {
    this.align(4);
    this.buf.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff);
  }

  rawUint32At(pos: number, v: number): void {
    this.buf[pos] = v & 0xff;
    this.buf[pos + 1] = (v >> 8) & 0xff;
    this.buf[pos + 2] = (v >> 16) & 0xff;
    this.buf[pos + 3] = (v >> 24) & 0xff;
  }

  string(s: string): void {
    const data = Buffer.from(s, "utf8");
    this.uint32(data.length);
    for (const b of data) this.buf.push(b);
    this.buf.push(0);
  }

  signature(s: string): void {
    const data = Buffer.from(s, "utf8");
    this.buf.push(data.length);
    for (const b of data) this.buf.push(b);
    this.buf.push(0);
  }
}

// Parse a single complete type out of a signature starting at i; returns end.
function typeEnd(sig: string, i: number): number {
  const c = sig[i];
  if (c === "a") return typeEnd(sig, i + 1);
  if (c === "(") {
    let depth = 1;
    let j = i + 1;
    while (depth > 0) {
      if (sig[j] === "(") depth++;
      else if (sig[j] === ")") depth--;
      j++;
    }
    return j;
  }
  if (c === "{") {
    let depth = 1;
    let j = i + 1;
    while (depth > 0) {
      if (sig[j] === "{") depth++;
      else if (sig[j] === "}") depth--;
      j++;
    }
    return j;
  }
  return i + 1;
}

function alignOf(sig: string, i: number): number {
  switch (sig[i]) {
    case "y":
    case "g":
    case "v":
      return 1;
    case "n":
    case "q":
      return 2;
    case "b":
    case "i":
    case "u":
    case "s":
    case "o":
    case "a":
      return 4;
    case "x":
    case "t":
    case "d":
    case "(":
    case "{":
      return 8;
    default:
      return 1;
  }
}

function marshal(w: Writer, sig: string, i: number, value: unknown): number {
  const c = sig[i];
  switch (c) {
    case "y":
      w.byte(value as number);
      return i + 1;
    case "b":
      w.uint32((value as boolean) ? 1 : 0);
      return i + 1;
    case "n":
    case "q":
      w.uint16(value as number);
      return i + 1;
    case "i":
    case "u":
      w.uint32(value as number);
      return i + 1;
    case "s":
    case "o":
      w.string(value as string);
      return i + 1;
    case "g":
      w.signature(value as string);
      return i + 1;
    case "v": {
      const vt = value as Variant;
      w.signature(vt.signature);
      marshal(w, vt.signature, 0, vt.value);
      return i + 1;
    }
    case "a": {
      const elemStart = i + 1;
      const elemEnd = typeEnd(sig, elemStart);
      w.align(4);
      const lenPos = w.length;
      w.uint32(0); // placeholder
      w.align(alignOf(sig, elemStart));
      const dataStart = w.length;
      if (sig[elemStart] === "{") {
        // dict: value is an array of [k, v] pairs or an object
        const entries: Array<[unknown, unknown]> = Array.isArray(value)
          ? (value as Array<[unknown, unknown]>)
          : Object.entries(value as Record<string, unknown>);
        const keyType = elemStart + 1;
        const valType = typeEnd(sig, keyType);
        for (const [k, v] of entries) {
          w.align(8);
          marshal(w, sig, keyType, k);
          marshal(w, sig, valType, v);
        }
      } else {
        for (const item of value as unknown[]) marshal(w, sig, elemStart, item);
      }
      const byteLen = w.length - dataStart;
      w.rawUint32At(lenPos, byteLen);
      return elemEnd;
    }
    case "(": {
      w.align(8);
      let j = i + 1;
      const arr = value as unknown[];
      let k = 0;
      while (sig[j] !== ")") {
        j = marshal(w, sig, j, arr[k++]);
      }
      return j + 1;
    }
    default:
      throw new Error(`marshal: unsupported type '${c}'`);
  }
}

// ---- Unmarshalling ---------------------------------------------------------

class Reader {
  constructor(public buf: Buffer, public pos = 0) {}
  align(n: number): void {
    while (this.pos % n !== 0) this.pos++;
  }
  byte(): number {
    return this.buf[this.pos++];
  }
  uint16(): number {
    this.align(2);
    const v = this.buf.readUInt16LE(this.pos);
    this.pos += 2;
    return v;
  }
  uint32(): number {
    this.align(4);
    const v = this.buf.readUInt32LE(this.pos);
    this.pos += 4;
    return v;
  }
  string(): string {
    const len = this.uint32();
    const s = this.buf.toString("utf8", this.pos, this.pos + len);
    this.pos += len + 1;
    return s;
  }
  signature(): string {
    const len = this.byte();
    const s = this.buf.toString("utf8", this.pos, this.pos + len);
    this.pos += len + 1;
    return s;
  }
}

function unmarshal(r: Reader, sig: string, i: number): [unknown, number] {
  const c = sig[i];
  switch (c) {
    case "y":
      return [r.byte(), i + 1];
    case "b":
      return [r.uint32() !== 0, i + 1];
    case "n":
    case "q":
      return [r.uint16(), i + 1];
    case "i":
    case "u":
      return [r.uint32(), i + 1];
    case "s":
    case "o":
      return [r.string(), i + 1];
    case "g":
      return [r.signature(), i + 1];
    case "v": {
      const vsig = r.signature();
      const [val] = unmarshal(r, vsig, 0);
      return [val, i + 1];
    }
    case "a": {
      const elemStart = i + 1;
      const elemEnd = typeEnd(sig, elemStart);
      const len = r.uint32();
      r.align(alignOf(sig, elemStart));
      const end = r.pos + len;
      const out: unknown[] = [];
      while (r.pos < end) {
        if (sig[elemStart] === "{") {
          r.align(8);
          const keyType = elemStart + 1;
          const valType = typeEnd(sig, keyType);
          const [k] = unmarshal(r, sig, keyType);
          const [v] = unmarshal(r, sig, valType);
          out.push([k, v]);
        } else {
          const [v] = unmarshal(r, sig, elemStart);
          out.push(v);
        }
      }
      r.pos = end;
      return [out, elemEnd];
    }
    case "(": {
      r.align(8);
      let j = i + 1;
      const arr: unknown[] = [];
      while (sig[j] !== ")") {
        const [v, nj] = unmarshal(r, sig, j);
        arr.push(v);
        j = nj;
      }
      return [arr, j + 1];
    }
    default:
      throw new Error(`unmarshal: unsupported type '${c}'`);
  }
}

function unmarshalBody(buf: Buffer, sig: string): unknown[] {
  const r = new Reader(buf);
  const out: unknown[] = [];
  let i = 0;
  while (i < sig.length) {
    const [v, ni] = unmarshal(r, sig, i);
    out.push(v);
    i = ni;
  }
  return out;
}

// ---- Message layer ---------------------------------------------------------

const MSG_METHOD_CALL = 1;
const MSG_METHOD_RETURN = 2;
const MSG_ERROR = 3;
const MSG_SIGNAL = 4;

interface Message {
  type: number;
  flags: number;
  serial: number;
  path?: string;
  iface?: string;
  member?: string;
  errorName?: string;
  replySerial?: number;
  destination?: string;
  sender?: string;
  signature?: string;
  body: unknown[];
}

export type MethodHandler = (msg: Message) => { signature: string; body: unknown[] } | null;

export class DBusConnection {
  private sock!: Socket;
  private serial = 1;
  private buf = Buffer.alloc(0);
  private pending = new Map<number, (msg: Message) => void>();
  private methodHandlers: Array<{ path: string; iface: string; member: string; fn: MethodHandler }> = [];
  uniqueName = "";

  static parseAddress(address: string): string {
    // unix:path=/tmp/... or unix:abstract=...
    const m = /unix:(?:path|abstract)=([^,]+)/.exec(address);
    if (!m) throw new Error(`unsupported D-Bus address: ${address}`);
    return address.includes("abstract=") ? "\0" + m[1] : m[1];
  }

  async connect(address?: string): Promise<void> {
    const addr = address ?? process.env.DBUS_SESSION_BUS_ADDRESS;
    if (!addr) throw new Error("no DBUS_SESSION_BUS_ADDRESS");
    const path = DBusConnection.parseAddress(addr);
    await new Promise<void>((resolve, reject) => {
      this.sock = connect(path as string, () => resolve());
      this.sock.on("error", reject);
    });
    await this.auth();
    this.sock.on("data", (d: Buffer | string) =>
      this.onData(typeof d === "string" ? Buffer.from(d) : d),
    );
    this.uniqueName = (await this.call({
      destination: "org.freedesktop.DBus",
      path: "/org/freedesktop/DBus",
      iface: "org.freedesktop.DBus",
      member: "Hello",
    })).body[0] as string;
  }

  private auth(): Promise<void> {
    return new Promise((resolve, reject) => {
      const uid = String(userInfo().uid);
      const hexUid = Buffer.from(uid, "utf8").toString("hex");
      const onData = (d: Buffer) => {
        const line = d.toString("utf8");
        if (line.startsWith("OK")) {
          this.sock.write("BEGIN\r\n");
          this.sock.removeListener("data", onData);
          resolve();
        } else if (line.startsWith("REJECTED") || line.startsWith("ERROR")) {
          reject(new Error("D-Bus auth failed: " + line.trim()));
        }
      };
      this.sock.on("data", onData);
      this.sock.write("\0");
      this.sock.write(`AUTH EXTERNAL ${hexUid}\r\n`);
    });
  }

  private buildMessage(m: Message): Buffer {
    const w = new Writer();
    w.byte(0x6c); // little-endian
    w.byte(m.type);
    w.byte(m.flags);
    w.byte(1); // version
    const bodyW = new Writer();
    if (m.signature) {
      // body marshalled with its signature
      let i = 0;
      let k = 0;
      while (i < m.signature.length) {
        i = marshal(bodyW, m.signature, i, m.body[k++]);
      }
    }
    const bodyBytes = bodyW.bytes();
    w.uint32(bodyBytes.length);
    w.uint32(m.serial);

    // header fields a(yv)
    const fields: Array<[number, Variant]> = [];
    if (m.path) fields.push([1, variant("o", m.path)]);
    if (m.iface) fields.push([2, variant("s", m.iface)]);
    if (m.member) fields.push([3, variant("s", m.member)]);
    if (m.errorName) fields.push([4, variant("s", m.errorName)]);
    if (m.replySerial !== undefined) fields.push([5, variant("u", m.replySerial)]);
    if (m.destination) fields.push([6, variant("s", m.destination)]);
    if (m.signature) fields.push([8, variant("g", m.signature)]);
    marshal(w, "a(yv)", 0, fields.map(([k, v]) => [k, v]));

    w.align(8);
    const header = w.bytes();
    return Buffer.concat([header, bodyBytes]);
  }

  private send(m: Message): void {
    this.sock.write(this.buildMessage(m));
  }

  private onData(d: Buffer): void {
    this.buf = Buffer.concat([this.buf, d]);
    for (;;) {
      const parsed = this.tryParse();
      if (!parsed) break;
    }
  }

  private tryParse(): boolean {
    if (this.buf.length < 16) return false;
    const r = new Reader(this.buf);
    r.byte(); // endianness (assume 'l')
    const type = r.byte();
    const flags = r.byte();
    r.byte(); // version
    const bodyLen = r.uint32();
    const serial = r.uint32();
    // header fields array
    const fieldsLenPos = r.pos;
    if (this.buf.length < fieldsLenPos + 4) return false;
    const fieldsLen = this.buf.readUInt32LE(fieldsLenPos);
    const headerEnd = fieldsLenPos + 4 + fieldsLen;
    const bodyStart = headerEnd + ((8 - (headerEnd % 8)) % 8);
    if (this.buf.length < bodyStart + bodyLen) return false;

    const [fields] = unmarshal(r, "a(yv)", 0);
    const msg: Message = { type, flags, serial, body: [] };
    for (const [code, val] of fields as Array<[number, unknown]>) {
      switch (code) {
        case 1: msg.path = val as string; break;
        case 2: msg.iface = val as string; break;
        case 3: msg.member = val as string; break;
        case 4: msg.errorName = val as string; break;
        case 5: msg.replySerial = val as number; break;
        case 6: msg.destination = val as string; break;
        case 7: msg.sender = val as string; break;
        case 8: msg.signature = val as string; break;
      }
    }
    const bodyBuf = this.buf.subarray(bodyStart, bodyStart + bodyLen);
    if (msg.signature) msg.body = unmarshalBody(bodyBuf, msg.signature);
    this.buf = this.buf.subarray(bodyStart + bodyLen);

    this.dispatch(msg);
    return true;
  }

  private dispatch(msg: Message): void {
    if (msg.type === MSG_METHOD_RETURN || msg.type === MSG_ERROR) {
      const cb = msg.replySerial !== undefined ? this.pending.get(msg.replySerial) : undefined;
      if (cb && msg.replySerial !== undefined) {
        this.pending.delete(msg.replySerial);
        cb(msg);
      }
      return;
    }
    if (msg.type === MSG_METHOD_CALL) {
      // org.freedesktop.DBus.Peer / introspection conveniences could go here.
      const handler = this.methodHandlers.find(
        (h) => h.path === msg.path && h.iface === msg.iface && h.member === msg.member,
      );
      if (handler) {
        const result = handler.fn(msg);
        if (result) {
          this.send({
            type: MSG_METHOD_RETURN,
            flags: 1,
            serial: this.serial++,
            replySerial: msg.serial,
            destination: msg.sender,
            signature: result.signature || undefined,
            body: result.body,
          });
          return;
        }
      }
      // Default: return an empty error so callers don't hang.
      this.send({
        type: MSG_ERROR,
        flags: 1,
        serial: this.serial++,
        replySerial: msg.serial,
        destination: msg.sender,
        errorName: "org.freedesktop.DBus.Error.UnknownMethod",
        signature: "s",
        body: ["No such method"],
      });
    }
  }

  call(m: {
    destination: string;
    path: string;
    iface: string;
    member: string;
    signature?: string;
    body?: unknown[];
  }): Promise<Message> {
    const serial = this.serial++;
    return new Promise((resolve, reject) => {
      this.pending.set(serial, (msg) => {
        if (msg.type === MSG_ERROR) reject(new Error(msg.errorName + ": " + (msg.body[0] ?? "")));
        else resolve(msg);
      });
      this.send({
        type: MSG_METHOD_CALL,
        flags: 0,
        serial,
        destination: m.destination,
        path: m.path,
        iface: m.iface,
        member: m.member,
        signature: m.signature,
        body: m.body ?? [],
      });
    });
  }

  emitSignal(m: { path: string; iface: string; member: string; signature?: string; body?: unknown[] }): void {
    this.send({
      type: MSG_SIGNAL,
      flags: 1,
      serial: this.serial++,
      path: m.path,
      iface: m.iface,
      member: m.member,
      signature: m.signature,
      body: m.body ?? [],
    });
  }

  export(path: string, iface: string, member: string, fn: MethodHandler): void {
    this.methodHandlers.push({ path, iface, member, fn });
  }

  async requestName(name: string, flags = 0): Promise<number> {
    const reply = await this.call({
      destination: "org.freedesktop.DBus",
      path: "/org/freedesktop/DBus",
      iface: "org.freedesktop.DBus",
      member: "RequestName",
      signature: "su",
      body: [name, flags],
    });
    return reply.body[0] as number;
  }

  close(): void {
    try {
      this.sock.end();
    } catch {}
  }
}
