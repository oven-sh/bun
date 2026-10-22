interface Point { x: number; y: number }
function attempt(what: string, run: () => unknown) { try { console.log(what, String(run())); } catch (error) { console.log(what, (error as Error).constructor.name); } }
const origin: Point = { x: 1, y: 2 };
class Holder { point!: Point; name!: string; run!: () => number; read(): number { return this.point.x; } tested(): string { return [this.point === undefined, this.name === undefined, typeof this.run, "point" in this, Object.keys(this).length].join(); } }
const holder = new Holder();
attempt("read", () => holder.read()); attempt("tested", () => holder.tested()); attempt("run", () => holder.run()); attempt("length", () => holder.name.length);
holder.point = origin; holder.name = "n"; holder.run = () => 3;
attempt("read", () => holder.read()); attempt("tested", () => holder.tested()); attempt("run", () => holder.run());
