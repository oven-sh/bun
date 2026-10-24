interface Point { x: number; y: number }
function attempt(what: string, run: () => unknown) { try { console.log(what, String(run())); } catch (error) { console.log(what, (error as Error).constructor.name); } }
const origin: Point = { x: 1, y: 2 };
class Holder { point: Point = origin; name: string = "n"; read(): number { return this.point.x + this.name.length; } test(): string { return [this.point === null, this.point === undefined, this.name === null, typeof this.name].join(); } }
const holder = new Holder(); attempt("read", () => holder.read());
holder.point = null as any; attempt("read", () => holder.read()); attempt("test", () => holder.test());
holder.point = origin; holder.name = undefined as any; attempt("read", () => holder.read()); attempt("test", () => holder.test());
holder.name = "nn"; attempt("read", () => holder.read());
(holder as any).point = undefined; attempt("test", () => holder.test()); delete (holder as any).point; attempt("test", () => holder.test() + ("point" in holder)); attempt("read", () => holder.read());
