// Each frame of a trace says whether `new` called it, at every value of Error.stackTraceLimit.
type Site = { getFunctionName(): string | null; isConstructor(): boolean };
const own = new Set(["f", "A", "Base", "Derived", "Plain", "makeNew", "makeDerived", "makeReflect", "makePlain"]);
(Error as any).prepareStackTrace = (_error: Error, sites: Site[]) =>
  sites
    .filter(site => own.has(site.getFunctionName() ?? ""))
    .map(site => site.getFunctionName() + "=" + site.isConstructor())
    .join(" ");

let captured = "";
function f(): void {
  captured = String(new Error("captured").stack);
}
function A(this: any): void {
  f();
}
class Base {
  constructor() {
    f();
  }
}
class Derived extends Base {
  constructor() {
    super();
  }
}
function Plain(this: any): void {
  f();
}

function makeNew(): void {
  new (A as any)();
}
function makeDerived(): void {
  new Derived();
}
function makeReflect(): void {
  [1].map(() => Reflect.construct(A, []));
}
function makePlain(): void {
  Plain.call({});
}

for (const make of [makeNew, makeDerived, makeReflect, makePlain]) {
  for (let limit = 1; limit <= 4; limit++) {
    Error.stackTraceLimit = limit;
    make();
    console.log(make.name, limit, captured);
  }
}
