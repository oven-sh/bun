// A property is created in the ordinary way: by a literal, a spread, a rest pattern, Object.assign, a class field. Somewhere else the program holds a definition of the same key whose descriptor leaves
// attributes out or says false. Such a definition keeps the attributes of a property that is there, and a call that never runs changes nothing. Every case has a key of its own.
const lines: string[] = [];
function show(label: string, object: any, key: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  lines.push(label + ": " + JSON.stringify(descriptor) + " | " + Object.keys(object).join() + " | " + JSON.stringify(object) + " | " + JSON.stringify({ ...object }));
}
function attempt(label: string, action: () => unknown): void {
  try {
    lines.push(label + ": " + JSON.stringify(action()));
  } catch (error: any) {
    lines.push(label + ": " + error.constructor.name);
  }
}
const never = lines.length > 1000;

const spreadOfAny: any = { a1: 2 };
const fromAny: any = { a1: 1, ...spreadOfAny };
show("spread of any, before", fromAny, "a1");
attempt("spread of any, defined", () => Object.defineProperty(fromAny, "a1", { value: 6 }) === fromAny);
show("spread of any, behind", fromAny, "a1");
attempt("spread of any, stored", () => (fromAny.a1 = 7));
show("spread of any, stored", fromAny, "a1");

const spreadNeverDefined: any = { a2: 2 };
const neverDefined: any = { a2: 1, ...spreadNeverDefined };
if (never) Object.defineProperty(neverDefined, "a2", { value: 6 });
show("the call never runs", neverDefined, "a2");
attempt("the call never runs, stored", () => (neverDefined.a2 = 7));

const typedSource: { a3: number; other: string } = { a3: 2, other: "x" };
const fromTyped = { ...typedSource, a3: 1 };
if (never) Object.defineProperty(fromTyped, "a3", { value: 6, writable: false, enumerable: false, configurable: false });
show("spread of a typed value", fromTyped, "a3");
attempt("spread of a typed value, stored", () => (fromTyped.a3 = 7));

class Source {
  a4 = 2;
  more = 3;
}
const fromInstance: any = { ...new Source() };
attempt("spread of an instance, defined", () => Object.defineProperty(fromInstance, "a4", { value: 6 }) === fromInstance);
show("spread of an instance", fromInstance, "a4");
attempt("spread of an instance, deleted", () => delete fromInstance.a4);
show("spread of an instance, deleted", fromInstance, "a4");

const proxy: any = new Proxy({ a5: 2 }, {});
const fromProxy: any = { a5: 1, ...proxy };
if (never) Reflect.defineProperty(fromProxy, "a5", { value: 6 });
show("spread of a proxy", fromProxy, "a5");

const { dropped, ...rest }: any = { dropped: 0, a6: 2, kept: 3 };
attempt("rest, defined", () => Reflect.defineProperty(rest, "a6", { value: 6 }));
show("rest", rest, "a6");
attempt("rest, stored", () => (rest.a6 = 7));

const assigned: any = Object.assign({}, { a7: 2 } as any);
if (never) Object.defineProperty(assigned, "a7", { value: 6 });
show("Object.assign", assigned, "a7");
const assignedOver: any = Object.assign({ a8: 1 }, JSON.parse('{"a8":2}'));
attempt("Object.assign of parsed text, defined", () => Object.defineProperty(assignedOver, "a8", { enumerable: false }) === assignedOver);
show("Object.assign of parsed text", assignedOver, "a8");

class Holder {
  field: any = { a9: 1, ...(spreadOfAny as any), a9b: 2 };
  b1: any = 1;
  constructor(options: any) {
    Object.assign(this, options);
  }
}
const holder = new Holder({ b1: 2 });
if (never) Object.defineProperty(holder, "b1", { value: 6 });
if (never) Object.defineProperty(holder.field, "a9", { value: 6 });
show("a class field", holder, "b1");
show("a literal in a class field", holder.field, "a9");

const twice: any = { b2: 1, ...({ b2: 2 } as any), ...({ b2: 3 } as any), ...spreadOfAny };
attempt("the same key twice, defined", () => Object.defineProperty(twice, "b2", { value: 6 }) === twice);
show("the same key twice", twice, "b2");

let chained: any = { __proto__: { b3: "inherited" } };
Object.defineProperty(chained, "b3", { value: "t", writable: false, enumerable: false, configurable: false });
show("defined first", chained, "b3");
chained = { b3: "own", ...chained };
show("then a literal with a spread of it", chained, "b3");

function Made(this: any, fill: (made: any) => void) {
  fill(this);
}
const plainly = new (Made as any)((made: any) => {
  made.b4 = 1;
});
const hidden = new (Made as any)((made: any) => {
  Object.defineProperty(made, "b4", { value: 2 });
});
const copied = new (Made as any)((made: any) => {
  Object.assign(made, JSON.parse('{"b4":3}'));
});
show("a function that hands this on, stored", plainly, "b4");
show("a function that hands this on, defined", hidden, "b4");
show("a function that hands this on, assigned", copied, "b4");
attempt("stored over the defined one", () => (hidden.b4 = 9));
attempt("stored over the assigned one", () => (copied.b4 = 9));
show("a function that hands this on, assigned and stored", copied, "b4");
console.log(lines.join("\n"));
