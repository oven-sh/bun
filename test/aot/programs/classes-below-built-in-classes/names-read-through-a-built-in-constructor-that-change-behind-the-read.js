// names read through a native constructor are cached: whatever can change behind the cache
const out = [];
function say(...a) { out.push(a.map(String).join(" ")); }
function attempt(name, f) { try { say(name, f()); } catch (e) { say(name, "threw", e.constructor.name); } }
class Failure extends Error { constructor(m) { super(m); this.name = "Failure"; } }
class Deep extends Failure {}
class Other extends TypeError {}
class Table extends Map {}
class List extends Array {}
class Later extends Promise {}
function kind(e) { if (e instanceof Deep) return "deep"; if (e instanceof Failure) return "failure"; if (e instanceof Other) return "other"; if (e instanceof Error) return "error"; return "none"; }
function caught(f) { try { f(); } catch (e) { return kind(e); } return "nothing"; }
const throwers = [() => { throw new Deep("d"); }, () => { throw new Failure("f"); }, () => { throw new Other("o"); }, () => { throw new Error("e"); }, () => { throw 5; }, () => { throw { __proto__: Failure.prototype }; }, () => { throw null; }];
function round() { return throwers.map(caught).join(); }
function warm() { let r; for (let i = 0; i < 200; i++) r = round(); return r; }
say("warm", warm());
function limit(C) { return C.stackTraceLimit; }
function read(C, k) { return C[k]; }
function missing(C) { return C.notThere; }
for (let i = 0; i < 300; i++) { limit(Failure); limit(Deep); missing(Failure); missing(Table); missing(List); missing(Later); }
say("limit", limit(Failure), limit(Deep), limit(Other), missing(Failure), missing(Table));
Error.stackTraceLimit = 3;
say("limit written on Error", limit(Failure), limit(Deep), limit(Other), limit(Error));
attempt("a new name on Error", () => { Error.notThere = "now there"; return [missing(Failure), missing(Deep), missing(Other), missing(Table)].join(); });
attempt("a new name on Map", () => { Map.notThere = "on Map"; return [missing(Table), missing(List)].join(); });
attempt("deleted from Error", () => { delete Error.notThere; return [missing(Failure), missing(Deep)].join(); });
attempt("deleted from Function.prototype", () => { delete Map.notThere; return [missing(Failure), missing(Table), missing(List)].join(); });
Failure.stackTraceLimit = 77;
say("own limit", limit(Failure), limit(Deep), limit(Other), limit(Error));
delete Failure.stackTraceLimit;
say("own limit gone", limit(Failure), limit(Deep));
attempt("limit deleted from Error", () => { delete Error.stackTraceLimit; return [limit(Failure), limit(Error)].join(); });
Error.stackTraceLimit = 10;
say("limit back", limit(Failure), limit(Deep));
// statics
function from(C, v) { return C.from(v); }
function of(C) { return C.of(1, 2); }
for (let i = 0; i < 300; i++) { from(List, [1]); of(List); }
say("from", from(List, [1, 2]) instanceof List, from(List, [1, 2]).length, of(List).constructor === List);
attempt("List.from own", () => { List.from = () => "own"; const r = from(List, [1]); delete List.from; return r + " " + from(List, [1]).length; });
function resolve(C, v) { return C.resolve(v); }
for (let i = 0; i < 300; i++) resolve(Later, 1);
say("resolve", resolve(Later, 1) instanceof Later);
function species(C) { return C[Symbol.species]; }
for (let i = 0; i < 300; i++) { species(List); species(Table); species(Later); }
say("species", species(List) === List, species(Table) === Table, species(Later) === Later, new List(1, 2, 3).map(x => x) instanceof List);
Object.defineProperty(List, Symbol.species, { get() { return Array; }, configurable: true });
say("species own", species(List) === Array, new List(1, 2, 3).map(x => x) instanceof List);
delete List[Symbol.species];
say("species back", species(List) === List, new List(1, 2, 3).map(x => x) instanceof List);
// Symbol.hasInstance
Object.defineProperty(Failure, Symbol.hasInstance, { value(v) { return v === 5; }, configurable: true });
say("hasInstance on Failure", round());
delete Failure[Symbol.hasInstance];
say("and gone", round());
say("and gone", round(), warm());
Object.defineProperty(Deep, Symbol.hasInstance, { get() { say("getter ran"); return undefined; }, configurable: true });
attempt("a getter that gives undefined", () => caught(throwers[0]));
delete Deep[Symbol.hasInstance];
// the constructors' parents move
Object.setPrototypeOf(Deep, Other);
say("parent of the constructor moved", limit(Deep), round(), Deep.name);
Object.setPrototypeOf(Deep, { [Symbol.hasInstance]() { return true; }, stackTraceLimit: "from an object" });
attempt("to a plain object", () => limit(Deep) + " " + round());
Object.setPrototypeOf(Deep, null);
attempt("to null", () => limit(Deep) + " " + round());
Object.setPrototypeOf(Deep, Failure);
say("back", limit(Deep), round());
// the prototypes move
Object.setPrototypeOf(Deep.prototype, Other.prototype);
say("parent of the prototype moved", round());
Object.setPrototypeOf(Deep.prototype, Failure.prototype);
say("back", round());
Object.defineProperty(Failure, "prototype", { value: Failure.prototype, writable: false });
attempt("function with prototype replaced", () => { function F() {} const x = new F(); let r = ""; for (let i = 0; i < 200; i++) r = x instanceof F; F.prototype = {}; return r + " " + (x instanceof F); });
attempt("bound", () => { const B = Failure.bind(null); let r; for (let i = 0; i < 200; i++) r = new Deep("x") instanceof B; return r; });
attempt("not callable", () => ({}) instanceof {});
attempt("prototype is not an object", () => { function F() {} F.prototype = 3; return ({}) instanceof F; });
say("names", Failure.name, Failure.length, Deep.length, Table.name, Object.getPrototypeOf(Failure) === Error, Failure.captureStackTrace === Error.captureStackTrace, typeof Failure.captureStackTrace);
attempt("isError", () => [Error.isError && Failure.isError(new Deep("x")), Table.groupBy === Map.groupBy, List.isArray(new List())].join());
console.log(out.join("\n"));
