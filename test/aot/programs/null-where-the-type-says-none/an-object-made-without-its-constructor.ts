interface Point { x: number; y: number }
function attempt(what: string, run: () => unknown) { try { console.log(what, String(run())); } catch (error) { console.log(what, (error as Error).constructor.name); } }
const origin: Point = { x: 1, y: 2 };
class Holder { point: Point = origin; name: string = "n"; read(): number { return this.point.x; } test(): string { return [this.point === undefined, this.name === undefined, Object.keys(this).length].join(); } }
const bare: Holder = Object.create(Holder.prototype);
attempt("read", () => bare.read()); attempt("test", () => bare.test()); attempt("is", () => bare instanceof Holder);
function use(holder: Holder): number { return holder.point.y; }
attempt("use", () => use(bare)); attempt("use", () => use(new Holder())); attempt("use", () => use({ __proto__: Holder.prototype, point: null } as any));
