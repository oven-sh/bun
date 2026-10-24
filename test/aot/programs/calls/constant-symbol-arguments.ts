// Functions entered by value whose parameters the compiler narrows to the constant symbols they are called with: each symbol passes the type test at the entry, alone and beside a string, numbers, a missing argument and objects.
const first = Symbol("first");
const second = Symbol("second");
const registered = Symbol.for("registered");
const values: any = { [first]: "value of first", [second]: "value of second", [registered]: "value of registered", text: "value of text", 7: "value of 7" };

class Point {
  constructor(public x: number) {}
}

function nameOf(key: any): string {
  if (key === first) return "first";
  if (key === second) return "second";
  if (key === registered) return "registered";
  return typeof key === "symbol" ? "another symbol" : typeof key;
}
function print(label: string, results: string[]): void {
  console.log(label + ": " + results.join(", "));
}

// A call site with three possible callees stays a call by value.
const symbolsOnly = [(key: any) => nameOf(key), (key: any) => String(key.description), (key: any) => String(values[key])];
const annotated = [(key: symbol) => nameOf(key), (key: symbol) => String(key.description), (key: symbol) => String(values[key])];
const symbolOrString = [(key: any) => nameOf(key), (key: any) => String(key.description), (key: any) => String(values[key])];
const symbolOrNumber = [(key: any) => nameOf(key), (key: any) => String(key.description), (key: any) => String(values[key])];
const symbolOrMissing = [(key?: any) => nameOf(key), (key?: any) => String(key?.description), (key?: any) => String(values[key])];
const symbolOrInstance = [(key: any) => nameOf(key), (key: any) => String(key.description ?? key.x), (key: any) => String(values[key])];
const symbolOrParsedObject = [(key: any) => nameOf(key), (key: any) => String(key.description ?? key.x), (key: any) => String(values[key])];
const anySymbol = [(key: any) => nameOf(key), (key: any) => String(key.description), (key: any) => String(values[key])];

let results: string[] = [];
for (const handler of symbolsOnly) results.push(handler(first), handler(second), handler(registered));
print("symbols only", results);

results = [];
for (const handler of annotated) results.push(handler(first), handler(second), handler(registered));
print("annotated", results);

results = [];
for (const handler of symbolOrString) results.push(handler(first), handler("text"));
print("symbol or string", results);

results = [];
for (const handler of symbolOrNumber) results.push(handler(second), handler(7), handler(0.5));
print("symbol or number", results);

results = [];
for (const handler of symbolOrMissing) results.push(handler(registered), handler());
print("symbol or missing", results);

results = [];
for (const handler of symbolOrInstance) results.push(handler(first), handler(new Point(1)));
print("symbol or instance", results);

results = [];
for (const handler of symbolOrParsedObject) results.push(handler(second), handler(JSON.parse('{"x":2}')));
print("symbol or parsed object", results);

results = [];
for (const handler of anySymbol) results.push(handler(first), handler(Symbol("first")));
print("any symbol", results);

export {};
