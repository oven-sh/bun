// Each evaluation of a literal is a new array. Whatever is done to one shows in no other.
function small(): number[] { return [1, 2, 3]; }
function fractions(): number[] { return [1.5, 2.5, 3.25]; }
function mixed(): (number | null | boolean | undefined)[] { return [1, null, true, undefined, 2.5, false]; }
function long(): number[] { return [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]; }
function longFractions(): number[] { return [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5, 12.5, 13.5, 14.5, 15.5, 16.5, 17.5, 18.5, 19.5]; }
function unwritten(): number[] { return [7, 8, 9]; }
function unwrittenFractions(): number[] { return [0.25, 0.75]; }

const makers: [string, () => any[]][] = [["small", small], ["fractions", fractions], ["mixed", mixed], ["long", long], ["longFractions", longFractions]];
const changes: [string, (a: any[]) => unknown][] = [
  ["store", a => { a[0] = 99; }],
  ["store a string", a => { a[1] = "x"; }],
  ["store a fraction", a => { a[1] = 0.125; }],
  ["store NaN", a => { a[2] = NaN; }],
  ["store behind the end", a => { a[a.length + 3] = 5; }],
  ["push", a => a.push(4)],
  ["pop", a => a.pop()],
  ["shift", a => a.shift()],
  ["unshift", a => a.unshift(-1)],
  ["splice", a => a.splice(1, 1, 70, 71)],
  ["sort", a => a.sort((x, y) => (y ?? 0) - (x ?? 0))],
  ["reverse", a => a.reverse()],
  ["fill", a => a.fill(6, 1)],
  ["copyWithin", a => a.copyWithin(0, 1)],
  ["shorter", a => { a.length = 1; }],
  ["longer", a => { a.length = a.length + 2; }],
  ["delete", a => delete a[1]],
  ["define", a => Object.defineProperty(a, 0, { value: 5, writable: true, enumerable: true, configurable: true })],
  ["define a getter", a => Object.defineProperty(a, 0, { get() { return 12; }, enumerable: true, configurable: true })],
  ["Reflect.set", a => Reflect.set(a, 2, 8)],
  ["a name", a => { (a as any).name = "n"; }],
  ["swap", a => { [a[0], a[1]] = [a[1], a[0]]; }],
  ["increment", a => { a[0]++; a[1] += 2; }],
  ["assign", a => Object.assign(a, [9, 9])],
  ["call of push", a => Array.prototype.push.call(a, 1, 2)],
  ["evaluated text", new Function("a", "a[0] = 'text'; a.push(1)") as (a: any[]) => unknown],
];
const show = (a: any[]) => JSON.stringify(a) + " " + a.length + " " + Object.keys(a).join();
for (const [name, make] of makers) {
  const before = show(make());
  for (const [what, change] of changes) {
    const kept = make(), changed = make();
    const result = change(changed);
    const after = make();
    console.log(name, what, show(changed), JSON.stringify(result) ?? "undefined", show(kept) === before, show(after) === before, kept !== after);
  }
}
let sum = 0;
for (let i = 0; i < 1000; i++) { const a = unwritten(), b = unwrittenFractions(); sum += a[i % 3] + b[i & 1] + a.length; }
console.log(sum, unwritten() === unwritten(), show(unwritten()), show(unwrittenFractions()));
const hidden = new Function("a", "a[1] = -1; return a");
console.log(show(hidden(unwritten())), show(unwritten()), show(hidden(unwrittenFractions())), show(unwrittenFractions()));
