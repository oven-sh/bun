// URLSearchParams.prototype.toJSON makes a new ordinary object with a tag of its own: a string for a name that stands once, a list of strings for one that stands more often.
const kept: unknown[] = [];
function handOn<T>(value: T): T {
  for (let i = 0; i < 2; i++) kept.length = Math.min(kept.length, 64);
  kept.push(value);
  return value;
}
const params = new URLSearchParams("a=1&a=2&b=3&c=");
const first = handOn((params as unknown as { toJSON(): Record<string, string | string[]> }).toJSON());
const second = handOn((params as unknown as { toJSON(): Record<string, string | string[]> }).toJSON());
console.log(first === second, Object.getPrototypeOf(first) === Object.prototype, Object.prototype.toString.call(first), Reflect.ownKeys(first).map(String).join());
console.log(Array.isArray(first.a), typeof first.b, first.c === "", JSON.stringify(first), JSON.stringify({ params }), JSON.stringify(new URLSearchParams()));
first.added = "stored by the program";
console.log(first.added, second.added, Object.keys(first).length, kept.length);
