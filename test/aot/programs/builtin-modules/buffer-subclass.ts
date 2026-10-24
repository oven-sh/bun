// A class that extends Buffer: its prototype chain, the ways to make an instance, and a method of its own.
class Packet extends Buffer {
    tag(): string { return "a packet"; }
}
const attempt = (label: string, run: () => unknown): void => { try { console.log(label + ":", String(run())); } catch (error) { console.log(label + ": throws", (error as Error).name, (error as Error).message.slice(0, 90)); } };
attempt("prototype chain", () => Object.getPrototypeOf(Packet.prototype) === Buffer.prototype && Object.getPrototypeOf(Packet) === Buffer);
attempt("new", () => { const p = new (Packet as any)(4); return p.length + " " + (p instanceof Packet) + " " + (p instanceof Buffer) + " " + (p instanceof Uint8Array) + " " + typeof p.tag; });
attempt("from", () => { const p = (Packet as any).from("abc"); return p.length + " " + (p instanceof Packet) + " " + p.toString(); });
attempt("a method on the prototype", () => Packet.prototype.tag.call(Buffer.from("x")));
attempt("typed arrays go on", () => { const bytes = new Uint8Array([3, 1, 2]); bytes.sort(); return bytes.join() + " " + bytes.subarray(1).length + " " + Buffer.from(bytes).toString("hex"); });
