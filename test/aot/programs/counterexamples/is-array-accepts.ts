// `Array.isArray` and `instanceof Array` narrow a Proxy over an array and `Array.prototype`.
declare const console: { log(...values: unknown[]): void };
function words(f: () => unknown): string { try { return String(f()) } catch (e) { return (e as Error).message.split(" (bun")[0].split("\n")[0] } }
function shape(value: object): string {
  const first: unknown = Object.getPrototypeOf(value);
  if (Array.isArray(value)) {
    if (!Array.isArray(first)) return "the prototype is no array";
    const second: unknown = Object.getPrototypeOf(first);
    return second === Object.prototype ? "plain" : "odd";
  }
  return first === Object.prototype ? "plain object" : "odd object";
}
console.log("1 " + words(() => shape([1, 2]) + " | " + shape({ part: 1 })));
function reads(x: unknown): string { if (Array.isArray(x)) return x.length + ":" + x[1] + ":" + x.map((v: number) => v * 2).join(); return "no array" }
console.log("2 " + words(() => reads(new Proxy([1, 2, 3], {}))));
console.log("3 " + words(() => reads([1, 2, 3]) + " " + reads("s") + " " + reads(Array.prototype)));
function byInstance(x: unknown): string { if (x instanceof Array) return x.length + ":" + x.indexOf(2); return "no instance" }
console.log("4 " + words(() => byInstance(new Proxy([1, 2, 3], {})) + " " + byInstance([2]) + " " + byInstance(Array.prototype)));
function anyOne(x: any): string { if (Array.isArray(x)) { let n = 0; for (const v of x) n += v; return "sum " + n } return "no array" }
console.log("5 " + words(() => anyOne(new Proxy([1, 2, 3], {})) + " " + anyOne([4, 5])));
