// A function that ends in a call of a value it was handed. The value is an arrow, a function with a prototype, a method, a bound function, a class, a built-in, a proxy of a function, a callable made by the host, and everything that cannot be called: The functions that end so are entered by native code (String.prototype.replace), so that none of them is copied into its caller: each time what plain Bun answers, and for what cannot be called its TypeError, with the name that the call is written with.
function none(act: any) { return act(); }
function one(act: any, first: unknown) { return act(first); }
function three(act: any, a: unknown, b: unknown, c: unknown) { return act(a, b, c); }
function five(act: any) { return act(1, 2, 3, 4, 5); }
function onThis(holder: any, first: unknown) { return holder.act(first); }
class Plain { constructor(public first: unknown = "none") { } }
function declared(this: unknown, ...all: unknown[]) { return "declared " + all.length + " " + typeof this; }
const withProperties: any = function (first: unknown) { return "with properties " + first; }; withProperties.extra = 1;
const callees: [string, any][] = [
  ["an arrow", (...all: unknown[]) => "arrow " + all.join()],
  ["an arrow of two", (a: unknown, b: unknown) => "two " + a + " " + b],
  ["declared", declared],
  ["with properties", withProperties],
  ["a method", { act(first: unknown) { return "method " + first; } }.act],
  ["bound", declared.bind("held", "bound")],
  ["a class", Plain],
  ["a built-in", Math.max],
  ["a built-in of strings", String],
  ["a proxy", new Proxy(declared, { })],
  ["a proxy with a trap", new Proxy(declared, { apply: (_target, _self, all) => "trapped " + all.length })],
  ["an async arrow", async () => 1],
  ["a generator", function* () { yield 1; }],
  ["undefined", undefined], ["null", null], ["a number", 7], ["a fraction", 0.5], ["a text", "text"], ["a symbol", Symbol.iterator], ["a bigint", 10n], ["true", true],
  ["an object", { }], ["a list", []], ["a proxy of an object", new Proxy({ }, { })], ["a date", new Date(0)], ["a pattern", /x/],
];
const said: string[] = [];
function tell(what: string, run: () => unknown) {
  try { said.push(what + ": " + "<>".replace("<", run as any)); }
  catch (error) { said.push(what + " throws " + (error as Error).constructor.name + ": " + (error as Error).message); }
}
for (let turn = 0; turn < 30; turn++) {
  said.length = 0;
  for (const [name, act] of callees) {
    tell(name + " none", () => none(act));
    tell(name + " one", () => one(act, 1));
    tell(name + " three", () => three(act, 1, 2, 3));
    tell(name + " five", () => five(act));
    tell(name + " on this", () => onThis({ act }, 1));
  }
}
console.log(said.join("\n"));
