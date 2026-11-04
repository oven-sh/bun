// Made by test/aot/tools/generate-lone-calls-of-built-in-methods.py.
let calls = 0;
let turn = 0;
function next(): number { calls++; return 40 + calls; }
function own<T extends object>(value: T): T { (value as any).includes = function () { calls++; return "own"; }; return value; }
const speaking: any = new Proxy({}, { get(_, key) { return typeof key === "symbol" ? undefined : key === "size" || key === "length" ? 1 : () => { calls++; return "spoken " + String(key); }; } });
const other: any = { includes() { calls++; return "other"; } };
class Below extends Array<number> { includes(...all: any[]): any { calls++; return "below"; } }
class BelowMap extends Map<string, number> { includes(...all: any[]): any { calls++; return "below"; } }
let notes = 0;
const noting = [(value: unknown) => { notes += value === undefined ? 1 : 2; }];
function noted(value: unknown) { noting[notes & 0](value); }
const handlers = {
  asked(text: string) {
    const answer = text.includes("b");
    noted(text);
    return answer;
  },
};
const names: ("asked")[] = ["asked"];
function shown(value: unknown): string {
  return Array.isArray(value) ? "[" + value.join() + "]" : String(value);
}
function safely(value: any): string {
  try {
    const answer = shown(handlers[names[0]](value));
    return answer + " | " + (value === null || value === undefined || typeof value !== "object" || value === speaking ? "" : Array.isArray(value) ? shown(value) + value.length : value instanceof Map ? String(value.size) : "");
  } catch (error: any) {
    return "thrown: " + error.name;
  }
}
for (turn = 0; turn < 3; turn++) console.log(safely("ab".concat(String(turn), "c")), calls);
