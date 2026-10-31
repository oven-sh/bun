// The objects of these classes have properties from their construction on: a field, and what the constructor of Error lays on an error. They reach code that nobody follows, so an own property
// may hide a method. Whether one does is asked of the object, and the methods are called directly: in the loop only the two fields are looked up by name.
// COUNT: arrivals <= 3100
class Defaults extends Map<string, number> {
  fallback: number;
  constructor(entries: [string, number][], fallback: number) {
    super(entries);
    this.fallback = fallback;
  }
  getOr(key: string): number {
    return this.get(key) ?? this.fallback;
  }
}
class Failure extends Error {
  code: number;
  constructor(message: string, code: number) {
    super(message);
    this.code = code;
  }
  isFatal(limit: number): boolean {
    return this.code > limit;
  }
}
function readDefault(defaults: Defaults, i: number): number {
  return defaults.getOr(i & 1 ? "a" : "b");
}
function judge(failure: Failure, i: number): number {
  return failure.isFatal(i & 7) ? 1 : 2;
}
const kept: unknown[] = [];
(globalThis as any).kept = kept;
const defaults = new Defaults([["a", 1]], 9);
const failure = new Failure("no", 4);
kept.push(defaults, failure);
let total = 0;
for (let i = 0; i < 2000; i++) total += readDefault(defaults, i) + judge(failure, i);
console.log(total);
