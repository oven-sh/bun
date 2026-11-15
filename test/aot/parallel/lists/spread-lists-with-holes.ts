// Lists spread into literals, pushes and Array.from: every length, every kind of storage, holes at every place.
const show = (list: any[]) => "[" + Array.from({ length: list.length }, (_, k) => (k in list ? (Object.is(list[k], -0) ? "-0" : String(list[k])) : "hole")).join() + "]";
let hash = 7; const note = (text: string) => { for (let k = 0; k < text.length; k++) hash = (hash * 31 + text.charCodeAt(k)) | 0; };
const makers: [string, (k: number) => any][] = [["whole", k => k - 2], ["fractions", k => k * 0.5 - 1], ["texts", k => "t" + k], ["mixed", k => (k % 3 ? k : "m" + k)], ["nothing", k => (k % 2 ? null : undefined)], ["unusual", k => [NaN, -0, Infinity, 2 ** 31][k & 3]]];
function listOf(size: number, at: (k: number) => any, hole: number, second = -1): any[] { const list: any[] = []; for (let k = 0; k < size; k++) list.push(at(k)); if (hole >= 0 && hole < size) delete list[hole]; if (second >= 0 && second < size) delete list[second]; return list; }
function spread(list: any[]) { return [...list]; }
function behind(list: any[], a: any) { return [a, ...list]; }
function before(list: any[], a: any) { return [...list, a]; }
function both(first: any[], second: any[]) { return [...first, ...second]; }
function pushed(target: any[], list: any[]) { target.push(...list); return target; }
function from(list: any[]) { return Array.from(list); }
function handed(...all: any[]) { return all.length + ":" + all.map(String).join(); }
function applied(list: any[]) { return handed(...list, "end"); }
let turns = 0;
for (const [name, at] of makers) {
  const lines: string[] = [];
  for (let size = 0; size < 21; size++) for (let hole = -1; hole < size; hole++) {
    const list = listOf(size, at, hole, hole < 0 ? -1 : (hole * 7) % 23);
    lines.push(show(spread(list)), show(behind(list, "a")), show(before(list, 0.5)), show(from(list)), applied(list));
    for (const [, other] of makers) { const second = listOf(size % 5, other, hole % 4); lines.push(show(both(list, second)), show(both(second, list)), show(pushed(listOf(3, other, -1), list)), show(pushed(spread(second), list))); }
    const kept = spread(list); kept.push("late"); kept[0] = 1; lines.push(show(list).length + " " + kept.length); turns++;
  }
  note(lines.join("\n")); console.log(name, lines.length, hash);
}
// Longer lists, a list that is spread onto itself, frozen and sealed lists, lists that share their storage, a subclass, one that reads its holes above it.
for (const size of [63, 64, 65, 127, 1000, 5000]) for (const hole of [-1, 0, 1, 62, size - 2, size - 1]) { const list = listOf(size, k => k, hole); const doubled = [...list, ...list]; note(doubled.length + String(doubled[hole < 0 ? 0 : hole]) + String(doubled[size + (hole < 0 ? 1 : hole)]) + String(doubled[2 * size - 1])); list.push(...list); note(list.length + String(list[size])); }
console.log(hash);
class Sub extends Array<any> { *[Symbol.iterator](): any { yield "own"; } } const sub = new Sub(); sub.push(1, 2); console.log(show([...sub]), show(Array.from(sub)), show(before(Object.freeze([1, , 3]) as any[], 4)), show(both(Object.seal([0.5, 1]) as any[], [, "x"])));
for (let k = 0; k < 40; k++) { const shared = [1, 2, , 4]; const copy = [...shared, k]; copy[2] = k; note(show(shared) + show(copy)); }
const above = (list: any[]) => Object.setPrototypeOf(list, Object.create(Array.prototype, { 1: { value: "above", writable: true, configurable: true, enumerable: true } })); for (let k = 0; k < 20; k++) note(show(spread(above(listOf(4, n => n, 1)))) + show(both(above(listOf(3, n => n * 0.5, 1)), [, , 1])) + show(from(above(listOf(3, n => "t" + n, 1)))) + show(pushed(above([1, , 3]), [4, , 5])));
try { const fixed: any[] = Object.freeze([]) as any; fixed.push(...listOf(2, k => k, -1)); } catch (error: any) { console.log(error.name); }
console.log(turns, hash);
