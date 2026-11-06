// A table, no seeds: a proxy is made over a handler that has no trap yet, something is asked through the proxy, the trap comes, the same is asked again, the trap goes, and it is asked a third time.
//
//   who the handler is x which trap and what asks for it x how the trap comes and goes x what else the program does
//
// One case to a program. The function that does it all is called from a loop.
type Named = { name: string; text: string };

const declarations = `class Bare {}
class WithConstructor { reads: number; constructor() { this.reads = 0; } }
class WithOtherTrap { apply() { return "applied"; } }
class Heir extends Bare {}
class Declared { get: any; has: any; set: any; deleteProperty: any; getOwnPropertyDescriptor: any; }
function Made(this: any) { this.reads = 0; }
const above: any = {};
function give(taker: any, name: string, given: any) { taker[name] = given; }
const names = ["color", "shade"];
`;

/** What `isBelowObject` has `Object.prototype` right above it: an executable does not store there. */
const handlers: readonly (Named & { isBelowObject?: true })[] = [
  { name: "an instance of a class without a name", text: "new (class {})()" },
  { name: "an instance of an empty class", text: "new Bare()" },
  { name: "an instance of a class with a constructor", text: "new WithConstructor()" },
  { name: "an instance of a class with another trap", text: "new WithOtherTrap()" },
  { name: "an instance of a class below an empty one", text: "new Heir()" },
  { name: "an instance of a class that declares the traps as fields", text: "new Declared()" },
  { name: "an object of a constructor function", text: "new (Made as any)()" },
  { name: "a literal", text: "{}", isBelowObject: true },
  { name: "a literal with another trap", text: '{ apply() { return "applied"; } }', isBelowObject: true },
  { name: "an object without a prototype", text: "Object.create(null)" },
  { name: "an object below another", text: "Object.create(above)" },
];

const told = '(held: any, key: any) => "trapped " + String(key)';
/** `trap` is the trap's name, `does` the trap, `text` what asks for it. */
const accesses: readonly (Named & { trap: string; does: string })[] = [
  { name: "a read", trap: "get", does: told, text: "paint.color" },
  { name: "a read under a key", trap: "get", does: told, text: "paint[names[round & 1]]" },
  { name: "a call", trap: "get", does: '(held: any, key: any) => () => "called " + String(key)', text: 'typeof paint.color === "function" ? paint.color() : paint.color' }, // prettier-ignore
  { name: "in", trap: "has", does: "() => false", text: '"color" in paint' },
  { name: "in with a key", trap: "has", does: "() => false", text: "names[round & 1] in paint" },
  { name: "a store", trap: "set", does: '(held: any, key: any, value: any) => { held[key] = value + "!"; return true; }', text: '(paint.color = "red" + said.length, target.color)' }, // prettier-ignore
  { name: "delete", trap: "deleteProperty", does: "() => true", text: '(target.shade = "dark", delete paint.shade) + " " + target.shade' }, // prettier-ignore
  {
    name: "Object.hasOwn",
    trap: "getOwnPropertyDescriptor",
    does: "() => undefined",
    text: 'Object.hasOwn(paint, "color")',
  },
  { name: "hasOwnProperty", trap: "getOwnPropertyDescriptor", does: "() => undefined", text: 'Object.prototype.hasOwnProperty.call(paint, "color")' }, // prettier-ignore
  { name: "the keys", trap: "ownKeys", does: '() => ["color"]', text: "Reflect.ownKeys(paint).join()" },
  { name: "the prototype", trap: "getPrototypeOf", does: "() => Array.prototype", text: "Object.getPrototypeOf(paint) === Array.prototype" }, // prettier-ignore
  { name: "Reflect.get of the handler for another", trap: "get", does: '"a value"', text: 'String(Reflect.get(handler, "get", target))' }, // prettier-ignore
  { name: "super in an object below the handler", trap: "get", does: '"a value"', text: "String(({ __proto__: handler, read() { return super.get; } } as any).read())" }, // prettier-ignore
];

/** `T` is the trap's name, `F` the trap. `needsAFunction`: the trap is called there. `storesAbove`: on the object above the handler. */
const arrivals: readonly { name: string; comes: string; goes: string; needsAFunction?: true; storesAbove?: true }[] = [
  { name: "by name", comes: "handler.T = F;", goes: "delete handler.T;" },
  { name: "under a written key", comes: 'handler["T"] = F;', goes: 'delete handler["T"];' },
  { name: "under a key made at run time", comes: 'handler[["T"].join("")] = F;', goes: "delete handler.T;" },
  {
    name: "by a definition",
    comes: 'Object.defineProperty(handler, "T", { value: F, configurable: true });',
    goes: "delete handler.T;",
  },
  { name: "as an accessor", comes: 'Object.defineProperty(handler, "T", { get: () => F, configurable: true });', goes: "delete handler.T;" }, // prettier-ignore
  { name: "by Object.assign", comes: "Object.assign(handler, { T: F });", goes: "delete handler.T;" },
  { name: "by Reflect.set", comes: 'Reflect.set(handler, "T", F);', goes: 'Reflect.deleteProperty(handler, "T");' },
  { name: "by a helper", comes: 'give(handler, "T", F);', goes: "delete handler.T;" },
  {
    name: "above the handler",
    comes: "const holder = Object.getPrototypeOf(handler) ?? handler; holder.T = F;",
    goes: "delete holder.T;",
    storesAbove: true,
  },
  { name: "by another prototype", comes: "const was = Object.getPrototypeOf(handler); Object.setPrototypeOf(handler, { T: F });", goes: "Object.setPrototypeOf(handler, was);" }, // prettier-ignore
  { name: "a number in its place", comes: "handler.T = 5;", goes: "delete handler.T;" },
  { name: "undefined, then null", comes: "handler.T = undefined;", goes: "handler.T = null;" },
  { name: "twice", comes: "handler.T = F; const first = handler.T; handler.T = (...all: any[]) => first(...all);", goes: "delete handler.T;", needsAFunction: true }, // prettier-ignore
];

const others: readonly Named[] = [
  { name: "beside a proxy that is constructed", text: "const constructible: any = new Proxy(function () {}, { get: () => 1 });\nconst built: any = new constructible();\nconsole.log(built.size);\n" }, // prettier-ignore
  { name: "alone", text: "" },
  { name: "beside Reflect.construct with another new.target", text: "const odd: any = Reflect.construct(Bare, [], function () {});\nconsole.log(odd instanceof Bare);\n" }, // prettier-ignore
];

const crossed = handlers.flatMap(handler =>
  accesses.flatMap(access =>
    arrivals
      .filter(arrival => !arrival.needsAFunction || access.does.startsWith("("))
      .filter(arrival => !arrival.storesAbove || !handler.isBelowObject)
      .flatMap(arrival => others.map(other => ({ handler, access, arrival, other }))),
  ),
);

const laidOut = [[], ["--aot-heat=everything-is-hot"]];
export const programs = laidOut.length * crossed.length;

/** The flags that the program of that number is built with. */
export const flagsOf = (index: number): string[] => laidOut[Math.floor(index / crossed.length)];

export function programOf(index: number): { file: string; text: string } {
  // Neighbors in the table differ in what else the program does alone: a stride that shares no factor with the length of the table takes a run's share from all over it.
  const { handler, access, arrival, other } = crossed[((index % crossed.length) * 7919) % crossed.length];
  const asks = `  try { said.push(${access.text}); } catch (error: any) { said.push(error.constructor.name); }\n`;
  const filled = (text: string) => text.replaceAll("T", access.trap).replaceAll("F", access.does);
  return {
    file: "main.ts",
    text: `console.log(${JSON.stringify(`${handler.name} | ${access.name} | ${arrival.name} | ${other.name}`)});
${declarations}${other.text}function work(round: number): string {
  const handler: any = ${handler.text};
  const target: any = { color: "blue", shade: "dark" };
  const paint: any = new Proxy(target, handler);
  const said: any[] = [];
${asks}  ${filled(arrival.comes)}
${asks}  ${filled(arrival.goes)}
${asks}  return said.map(String).join(", ") + " | " + JSON.stringify(target);
}
for (let round = 0; round < 2; round++) console.log(work(round));
export {};
`,
  };
}
