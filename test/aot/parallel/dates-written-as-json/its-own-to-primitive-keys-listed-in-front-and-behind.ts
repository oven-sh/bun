// Made by test/aot/tools/generate-dates-written-as-json.py.
let calls = 0;
class Below extends Date {}
class Speaking extends Date { toISOString(): string { calls++; return "speaking"; } }
function changed(date: Date, change: (date: Date) => unknown): Date { change(date); return date; }
function write(date: Date): string | null { return date.toJSON(); }
function safely(date: Date): string {
  try {
    return String(write(date)) + " " + calls;
  } catch (error: any) {
    return "thrown: " + error.name + " " + calls;
  }
}
console.log(Object.getOwnPropertyNames(Date.prototype).length);
for (let turn = 0; turn < 3; turn++) console.log(safely(changed(new Date(0), d => Object.defineProperty(d, Symbol.toPrimitive, { value: () => { calls++; return Infinity; } }))));
console.log(Object.getOwnPropertyNames(Date.prototype).join());
