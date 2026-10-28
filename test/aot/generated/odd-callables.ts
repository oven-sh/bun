// Every callable that is neither a closure nor a built-in function (bound functions, proxies, classes ..) at every way to call or construct it.
// One program a site. Each pair of a callable and a site has classes, targets and variables of its own, so that what the compiler learns of one says nothing of another.
export const programs: { name: string; text: string }[] = [];

type Road = [name: string, text: (k: string) => string];

const constructRoads: Road[] = [
  ["class", k => `(Alpha${k} as any).bind(null)`],
  ["class+1", k => `(Alpha${k} as any).bind(null, 1)`],
  ["class+2", k => `(Alpha${k} as any).bind(null, 1, 2)`],
  ["bound-of-bound", k => `(Alpha${k} as any).bind(null).bind(null, 1)`],
  ["bound-of-bound+1+1", k => `(Alpha${k} as any).bind(null, 1).bind(null, 2)`],
  ["derived", k => `(Gamma${k} as any).bind(null, 1)`],
  ["function", k => `(Plain${k} as any).bind({ z: 1 }, 2)`],
  ["function-answers-object", k => `(Answers${k} as any).bind(null, 2)`],
  ["function-answers-seen", k => `(AnswersSeen${k} as any).bind(null)`],
  ["Map", () => `(Map as any).bind(null)`],
  ["Set", () => `(Set as any).bind(null, [1, 2])`],
  ["Array", () => `(Array as any).bind(null, 3)`],
  ["Date", () => `(Date as any).bind(null, 0)`],
  ["Error", () => `(Error as any).bind(null, "m")`],
  ["RegExp", () => `(RegExp as any).bind(null, "a+")`],
  ["Uint8Array", () => `(Uint8Array as any).bind(null, 4)`],
  ["Object", () => `(Object as any).bind(null)`],
  ["String", () => `(String as any).bind(null, "s")`],
  ["Number", () => `(Number as any).bind(null, 5)`],
  ["Boolean", () => `(Boolean as any).bind(null, true)`],
  ["Promise", () => `(Promise as any).bind(null, () => {})`],
  ["Proxy", () => `(Proxy as any).bind(null, { p: 1 }, {})`],
  ["Function", () => `(Function as any).bind(null, "return 5")`],
  ["proxy-of-class", k => `new Proxy(Alpha${k}, {})`],
  [
    "proxy-with-trap",
    k => `new Proxy(Alpha${k}, { construct(target: any, list: any[]) { return new Beta${k}(list.length); } })`,
  ],
  ["proxy-of-bound", k => `new Proxy((Alpha${k} as any).bind(null, 1), {})`],
  ["bound-of-proxy", k => `(new Proxy(Alpha${k}, {}) as any).bind(null, 1)`],
  ["Math.max", () => `(Math.max as any).bind(null, 5)`],
  ["arrow", () => `(() => 1).bind(null)`],
  ["method", () => `({ m() { return 1; } }).m.bind(null)`],
  ["async", () => `(async function () {}).bind(null)`],
  ["generator", () => `(function* () {}).bind(null)`],
  ["no-function", () => `Object.create(null)`],
];

const constructSites: Road[] = [
  ["new", k => `new made${k}(10, 20)`],
  ["new-spread", k => `new made${k}(...list${k})`],
  ["reflect", k => `Reflect.construct(made${k}, [10, 20])`],
  ["reflect-other-target", k => `Reflect.construct(made${k}, [10, 20], Beta${k})`],
  ["reflect-as-target", k => `Reflect.construct(Beta${k}, [10], made${k})`],
  ["extends", k => `new (class Below${k} extends made${k} { below = 1; })(10, 20)`],
  [
    "extends-with-constructor",
    k =>
      `new (class Below${k} extends made${k} { below: number; constructor(a: any, b: any) { super(a, b); this.below = 1; } })(10, 20)`,
  ],
  ["arrow-parameter", k => `((value: any) => new value(10, 20))(made${k})`],
];

function constructBlock(k: string, label: string, road: string, site: string): string {
  return `
class Seen${k} { a: number = 1; b: number = 2; constructor(a?: any, b?: any) { if (a === -1) this.a = b; } who(): string { return "seen" + (this.a + this.b); } }
class Alpha${k} { s: string; t: string; n: string; constructor(s: any, t: any) { this.s = "s" + s; this.t = "t" + t; this.n = new.target === Alpha${k} ? "self" : typeof new.target === "function" ? "other:" + new.target.name : "none"; } who(): string { return "alpha" + this.s + this.t + this.n; } }
class Beta${k} { q: any; constructor(q?: any) { this.q = q; } who(): string { return "beta" + this.q; } }
class Gamma${k} extends Alpha${k} { g: number; constructor(s: any, t: any) { super(s, t); this.g = 9; } who(): string { return "gamma" + this.g + super.who(); } }
function Plain${k}(this: any, a: any, b: any) { this.pa = a; this.pb = b; this.pn = new.target === Plain${k}; }
function Answers${k}(a: any, b: any) { return { made: a, with: b }; }
function AnswersSeen${k}() { return new Seen${k}(-1, 40); }
const list${k}: any[] = [10, 20];
let made${k}: any = Seen${k};
function use${k}(): string {
  const o: any = ${site};
  return String(o.a) + "|" + String(o.b) + "|" + String(o.s) + "|" + (typeof o.who === "function" ? o.who() : "-") + "|" + (o instanceof Seen${k}) + "|" + (o instanceof Alpha${k}) + "|" + Object.keys(o).join() + "|" + Object.prototype.toString.call(o);
}
function seen${k}(): void { made${k} = Seen${k}; }
function road${k}(): void { made${k} = ${road}; }
for (let turn = 0; turn < 3; turn++) { seen${k}(); say(${JSON.stringify(label)} + " seen", use${k}); road${k}(); say(${JSON.stringify(label)} + " road", use${k}); }
`;
}

const head = `
function say(label: string, run: () => unknown): void {
  let text: string;
  try { text = String(run()); } catch (error) { text = "THROWS " + (error as Error).constructor.name; }
  console.log(label + ": " + text);
}
`;

for (const [siteName, site] of constructSites) {
  let text = head;
  constructRoads.forEach(([roadName, road], index) => {
    const k = "_" + index;
    text += constructBlock(k, roadName, road(k), site(k));
  });
  programs.push({ name: `construct ${siteName}`, text });
}

const callRoads: Road[] = [
  ["bind", k => `target${k}.bind(self${k})`],
  ["bind+1", k => `target${k}.bind(self${k}, "x")`],
  ["bind+3", k => `target${k}.bind(self${k}, "x", "y", "z")`],
  ["bound-of-bound", k => `target${k}.bind(self${k}).bind(other${k}, "x")`],
  ["bind-no-this", k => `target${k}.bind(undefined)`],
  ["bind-nothing", k => `(target${k} as any).bind()`],
  ["bind-primitive-this", k => `target${k}.bind(7, "x")`],
  ["arrow", k => `((a: any, b: any, c: any) => target${k}.call(self${k}, a, b, c)).bind(other${k}, "x")`],
  ["method", k => `holder${k}.method.bind(holder${k}, "x")`],
  ["static", k => `Statics${k}.method.bind(Statics${k}, "x")`],
  ["call.bind", k => `Function.prototype.call.bind(target${k})`],
  ["call.bind+this", k => `Function.prototype.call.bind(target${k}, self${k})`],
  ["apply.bind", k => `Function.prototype.apply.bind(target${k}, self${k})`],
  ["bind.bind", k => `Function.prototype.bind.bind(target${k}, self${k})`],
  ["Reflect.apply.bind", k => `Reflect.apply.bind(null, target${k}, self${k})`],
  ["proxy", k => `new Proxy(target${k}, {})`],
  [
    "proxy-with-trap",
    k =>
      `new Proxy(target${k}, { apply(inner: any, me: any, list: any[]) { return "trap" + list.length + inner.call(self${k}, "p", ...list); } })`,
  ],
  ["proxy-of-bound", k => `new Proxy(target${k}.bind(self${k}, "x"), {})`],
  ["bound-of-proxy", k => `new Proxy(target${k}, {}).bind(self${k}, "x")`],
  ["Math.max", () => `(Math.max as any).bind(null, 15)`],
  ["String", () => `(String as any).bind(null)`],
  ["push", k => `Array.prototype.push.bind(pushed${k})`],
  ["class", k => `(Class${k} as any).bind(null)`],
  ["no-function", () => `Object.create(null)`],
];

const callSites: [string, (k: string) => string, boolean?][] = [
  ["call", k => `called${k}(10, 20)`],
  ["call-none", k => `called${k}()`],
  ["call-many", k => `called${k}(10, 20, 30, 40, 50)`],
  ["call-spread", k => `called${k}(...list${k})`],
  ["optional", k => `called${k}?.(10, 20)`],
  [".call", k => `called${k}.call(other${k}, 10, 20)`],
  [".apply", k => `called${k}.apply(other${k}, [10, 20])`],
  ["Reflect.apply", k => `Reflect.apply(called${k}, other${k}, [10, 20])`],
  ["method", k => `(place${k}.m = called${k}, place${k}.m(10, 20))`],
  ["computed-method", k => `(place${k}.m = called${k}, place${k}[key${k}](10, 20))`],
  ["arrow-parameter", k => `((value: any) => value(10, 20))(called${k})`],
  ["map", k => `[10, 20].map(called${k}).join(";")`],
  ["forEach", k => `([10, 20].forEach(called${k}), log${k}.splice(0).join(";"))`],
  ["reduce", k => `[10, 20, 30].reduce(called${k})`],
  ["sort", k => `([3, 1, 2].sort(called${k}), log${k}.splice(0).length > 0)`],
  ["from", k => `Array.from({ length: 2 }, called${k}).join(";")`],
  ["replace", k => `"abc".replace(/b/, called${k})`],
  ["stringify", k => `(JSON.stringify({ p: 1 }, called${k}), log${k}.splice(0).join(";"))`],
  ["parse", k => `(JSON.parse('{"p":1}', called${k}), log${k}.splice(0).join(";"))`],
  ["getter", k => `(Object.defineProperty({}, "p", { get: called${k} }) as any).p`],
  ["setter", k => `((Object.defineProperty({}, "p", { set: called${k} }) as any).p = 10, log${k}.splice(0).join(";"))`],
  ["toString", k => `"" + { toString: called${k} }`],
  ["valueOf", k => `"" + ({ valueOf: called${k}, toString: undefined } as any)`],
  ["toPrimitive", k => `\`\${{ [Symbol.toPrimitive]: called${k} }}\``],
  ["toJSON", k => `JSON.stringify({ toJSON: called${k} })`],
  ["tag", k => `called${k}\`a\${10}b\``],
  ["handler-get", k => `(new Proxy({}, { get: called${k} }) as any).p`],
  ["has-instance", k => `(({}) as any) instanceof ({ [Symbol.hasInstance]: called${k} } as any)`],
  ["map-forEach", k => `(new Map([[10, 20]]).forEach(called${k}), log${k}.splice(0).join(";"))`],
  ["then", k => `await Promise.resolve(10).then(called${k})`, true],
  [
    "thenable",
    k =>
      `await Promise.race([{ then: called${k} }, new Promise(done => setTimeout(done, 5, "late"))]).then(value => value + "/" + log${k}.splice(0).join(";"))`,
    true,
  ],
  [
    "timeout",
    k =>
      `await new Promise(done => { setTimeout(called${k}, 0, 10, 20); setTimeout(() => done(log${k}.splice(0).join(";")), 5); })`,
    true,
  ],
  [
    "microtask",
    k =>
      `await new Promise(done => { queueMicrotask(called${k}); setTimeout(() => done(log${k}.splice(0).join(";")), 1); })`,
    true,
  ],
  [
    "nextTick",
    k =>
      `await new Promise(done => { process.nextTick(called${k}, 10, 20); setTimeout(() => done(log${k}.splice(0).join(";")), 1); })`,
    true,
  ],
  [
    "executor",
    k => `(new Promise(called${k}).catch(() => {}), log${k}.splice(0).join(";").replace(/function[^,;]*/g, "fn"))`,
  ],
];

function callBlock(k: string, label: string, road: string, site: string, isAsync: boolean): string {
  return `
const self${k}: any = { name: "self" };
const other${k}: any = { name: "other" };
const log${k}: string[] = [];
const pushed${k}: any[] = [];
const place${k}: any = { m: null };
const key${k}: string = ["m"][0];
const list${k}: any[] = [10, 20];
function short${k}(value: any): string { return value === self${k} ? "self" : value === other${k} ? "other" : value === undefined ? "undefined" : typeof value === "object" || typeof value === "function" ? typeof value : typeof value + ":" + String(value); }
function target${k}(this: any, a: any, b: any, c: any): any {
  const text = short${k}(this) + "," + short${k}(a) + "," + short${k}(b) + "," + short${k}(c) + "," + arguments.length + "," + (new.target === undefined) + "," + (typeof a === "number" ? a + 1 : "-") + "," + (typeof b === "number" ? b * 2 : "-");
  log${k}.push(text);
  return text;
}
function seenTarget${k}(this: any, a: any, b: any, c: any): any { const text = "seen," + short${k}(this) + "," + short${k}(a) + "," + short${k}(b) + "," + arguments.length; log${k}.push(text); return text; }
const holder${k} = { name: "holder", method(a: any, b: any, c: any): any { return this.name + target${k}.call(self${k}, a, b, c); } };
class Statics${k} { static label = "statics"; static method(a: any, b: any, c: any): any { return this.label + target${k}.call(self${k}, a, b, c); } }
class Class${k} { a = 1; }
target${k}.call(self${k}, 1, 2, 3);
log${k}.length = 0;
let called${k}: any = seenTarget${k};
${isAsync ? "async " : ""}function use${k}()${isAsync ? ": Promise<unknown>" : ": unknown"} { return ${site}; }
function seen${k}(): void { called${k} = seenTarget${k}; }
function road${k}(): void { called${k} = ${road}; }
for (let turn = 0; turn < 3; turn++) { seen${k}(); ${isAsync ? "await sayLater" : "say"}(${JSON.stringify(label)} + " seen", use${k}); log${k}.length = 0; road${k}(); ${isAsync ? "await sayLater" : "say"}(${JSON.stringify(label)} + " road", use${k}); log${k}.length = 0; }
`;
}

const asyncHead = `
const uncaught: string[] = [];
process.on("uncaughtException", error => { uncaught.push((error as Error).constructor.name); });
async function sayLater(label: string, run: () => Promise<unknown>): Promise<void> {
  let text: string;
  try { text = String(await run()); } catch (error) { text = "THROWS " + (error as Error).constructor.name; }
  console.log(label + ": " + text + (uncaught.length ? " UNCAUGHT " + uncaught.splice(0).join() : ""));
}
`;

for (const [siteName, site, isAsync] of callSites) {
  let text = head + (isAsync ? asyncHead : "");
  callRoads.forEach(([roadName, road], index) => {
    const k = "_" + index;
    text += callBlock(k, roadName, road(k), site(k), !!isAsync);
  });
  programs.push({ name: `call ${siteName}`, text });
}
