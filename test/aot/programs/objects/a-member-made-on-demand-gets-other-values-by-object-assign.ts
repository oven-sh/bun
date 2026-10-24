// A function member that is only called is made on demand: its slot says "not made yet". Whoever gives the property another value, by a way that no type stands in front of,
// must find that value again by every way of reading, also where the reads are hot and take an empty slot for an absent property.
type Any = any;
interface Later { count: number; action?: () => number; }
interface Plain extends Later { first: number; action: () => number; }
interface Over extends Later { second: number; action: () => number; }
interface Stored extends Later { third: number; }
function plain(n: number): Plain { return { count: n, first: 1, action: () => 3 }; }
function over(n: number): Over { const made: Over = { count: n, second: 2, action: () => made.count + 2 }; return made; }
function later(n: number): Stored { const made: Stored = { count: n, third: 3 }; made.action = () => made.count + 4; return made; }
const makers: [string, (n: number) => Later][] = [["plain", plain], ["over the object", over], ["stored later", later]];

function kind(p: Later): string { return typeof p.action; }
function read(p: Later): unknown { return p.action; }
function call(p: Later): string { try { return String(p.action!()); } catch (error) { return (error as Error).constructor.name; } }
function has(p: Later): boolean { return "action" in p; }
function own(p: Later): boolean { return Object.hasOwn(p, "action"); }
function keys(p: Later): string { return Object.keys(p).join(); }
function truthy(p: Later): boolean { return p.action ? true : false; }
function orElse(p: Later): unknown { return p.action ?? "nothing"; }
function optional(p: Later): unknown { try { return p.action?.(); } catch (error) { return (error as Error).constructor.name; } }
function show(value: unknown): string { return typeof value === "function" ? "function" : typeof value === "object" && value !== null ? JSON.stringify(value) : String(value); }
function all(p: Later): string {
  return [kind(p), show(read(p)), call(p), has(p), own(p), keys(p), truthy(p), show(orElse(p)), show(optional(p)), JSON.stringify(p, (_, each) => typeof each === "bigint" ? "bigint" : each), show({ ...p }.action), Object.entries(p).length, show(Object.getOwnPropertyDescriptor(p, "action")?.value)].join(" ");
}

let warm = 0;
for (let i = 0; i < 3000; i++) {
  for (const [, make] of makers) {
    const p = make(i & 3);
    warm += kind(p).length + (has(p) ? 1 : 0) + (own(p) ? 1 : 0) + (truthy(p) ? 1 : 0) + call(p).length + (read(p) === undefined ? 1 : 0) + (orElse(p) === "nothing" ? 1 : 0) + Number(optional(p));
  }
}
console.log(warm);

const name = ["act", "ion"].join("");
const ways: [string, (p: Any, value: unknown) => void][] = [
  ["Object.assign", (p, value) => { Object.assign(p, { action: value }); }],
];
const values: unknown[] = [5, 1.5, "text", true, false, 0, "", 7n, undefined, null, { inner: 1 }, [1, 2], () => 9];
for (const [title, make] of makers) {
  for (const [way, put] of ways) {
    for (const value of values) {
      const p = make(1);
      put(p, value);
      const first = all(p);
      put(p, () => 11);
      const second = all(p);
      put(p, value);
      delete (p as Any).action;
      console.log(title + ", " + way + ", " + show(value) + ": " + first + " | " + second + " | " + all(p));
    }
  }
}
for (const [title, make] of makers) {
  const called = make(2);
  const before = call(called);
  ways[0][1](called, 5);
  const untouched = make(2);
  console.log(title + ": " + before + " " + all(called) + " | " + all(untouched));
}
