// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 3
// CHECK-LABEL: function {{*}}name="Top"
// CHECK-LABEL: function {{*}}name="deliver"
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK-LABEL: function {{*}}name="Sub"
// CHECK-LABEL: function {{*}}name="emit"

// FILE: main.ts
// The predicted callee follows the prototype chain between constructor functions, through names of type `any`, and a wrong prediction does no harm.
import middle from "./req/un_chain_middle";
declare const console: any;
const { Middle, helper } = middle;
function Top(this: any, options?: any) { this.state = { n: 0 }; Middle.call(this, options); }
Object.setPrototypeOf(Top.prototype, Middle.prototype);
Object.setPrototypeOf(Top, Middle);
Top.prototype.push = function (this: any, chunk: any) { return push(this, this.state, chunk); };
function push(stream: any, state: any, chunk: any) { return deliver(stream, state, chunk); }
function deliver(stream: any, state: any, chunk: any) { state.n++; return stream.emit("data", chunk); }
let n = 0;
const listen = function (this: any, v: number) { n += v };
function attempt(label: string, f: () => unknown) { try { console.log(label + ":", String(f()), n) } catch (e) { console.log(label + ":", (e as Error).constructor.name, n) } }
function make() { const t = new (Top as any)(); t.on("data", listen); return t }
attempt("inherited two levels up", () => make().emit("data", 1));
attempt("handed down two calls", () => make().push(2));
attempt("the nearest wins", () => [make().name(), new Middle().name()].join());
attempt("added with addListener", () => { const t = new (Top as any)(); t.addListener("data", listen); return t.push(3) });
attempt("added through a helper", () => { const t = new (Top as any)(); helper(t, "data", listen); return t.push(4) });
attempt("instanceof", () => [make() instanceof Middle, make() instanceof (Top as any), Object.getPrototypeOf(Top) === Middle].join());
class Sub extends (Top as any) { ping() { return this.emit("data", 5) } }
class SubOverriding extends (Top as any) { emit() { return "overridden" } ping() { return (this as any).emit("data", 5) } }
attempt("a class on top", () => { const s: any = new Sub(); s.on("data", listen); return [s.ping(), s.push(6)].join() });
attempt("a class that overrides", () => { const s: any = new SubOverriding(); s.on("data", listen); return [s.ping(), s.push(6)].join() });
// The inheriting object gets its own function afterwards.
const before = make();
Top.prototype.emit = function () { return "top's own" };
attempt("the heir shadows", () => [before.emit("data", 1), before.push(1), make().push(1), new Middle().emit("data", 1)].join());
delete Top.prototype.emit;
attempt("and does not any more", () => before.push(7));
// The prototype chain is cut and reattached elsewhere.
const Other: any = function (this: any) {}; Other.prototype.emit = function () { return "other" }; Other.prototype.on = function () { return this };
Object.setPrototypeOf(Top.prototype, Other.prototype);
attempt("another base", () => [before.emit("data", 1), before.push(1), make().push(1)].join());
Object.setPrototypeOf(Top.prototype, null);
attempt("no base", () => before.push(1));
Object.setPrototypeOf(Top.prototype, Middle.prototype);
attempt("the first base again", () => before.push(8));
// `on` is stored again: `addListener` stays.
Object.getPrototypeOf(Middle.prototype).on = function () { return "no listener" };
attempt("the second name is replaced", () => { const t = new (Top as any)(); return [t.on("data", listen), t.push(9), t.addListener("data", listen) === t, t.push(9)].join() });
export {};

// FILE: req/un_chain_base.ts
function Base(this: any) { this._events = Object.create(null); this.count = 0; }
const BasePrototype: any = (Base.prototype = {} as any);
BasePrototype.constructor = Base;
BasePrototype.emit = function emit(this: any, type: any, a: any) { const h = this._events[type]; if (h === undefined) return false; h.call(this, a); return true; };
BasePrototype.addListener = function addListener(this: any, type: any, fn: any) { add(this, type, fn); return this; };
BasePrototype.on = BasePrototype.addListener;
BasePrototype.name = function name() { return "base"; };
function add(target: any, type: any, fn: any) { var events = target._events; if (!events) events = target._events = Object.create(null); events[type] = fn; target.count++; }
export default Base as any;

// FILE: req/un_chain_middle.ts
import base from "./un_chain_base";
const Base = base as any;
function Middle(this: any, options?: any) { Base.call(this, options); this.middle = true; }
Object.setPrototypeOf(Middle.prototype, Base.prototype);
Object.setPrototypeOf(Middle, Base);
Middle.prototype.name = function name() { return "middle"; };
function helper(e: any, type: any, fn: any) { return e.on(type, fn); }
export default { Middle, helper } as unknown as { Middle: any; helper: any };

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
