// STATISTIC: CopiesThatAreDefinitionsOneByOne >= 1
// The source is born with the layout that the copy expects and changed behind its birth through a key that nobody knows: the layout alone says nothing of that: the copy asks the object for its own keys.
const log: string[] = [];
function show(o: any): string { return Reflect.ownKeys(o).map(k => String(k) + "=" + String(Object.getOwnPropertyDescriptor(o, k)!.get ? "getter" : o[k])).join(","); }
type More = { request: number; user: string };
const sym = Symbol("s");
function born(request: number, user: string): More { return { request, user }; }
const key = (text: string): any => JSON.parse(JSON.stringify(text));
function put(o: any, k: any, v: any) { o[k] = v; }
function drop(o: any, k: any) { delete o[k]; }
function define(o: any, k: any, d: any) { Object.defineProperty(o, k, d); }
const odd = born(17, "i"); put(odd, key("1"), "one");
const sources: More[] = [born(1, "a"), born(2, "b"), odd, born(3, "c")];
function two(first: any, second: More) { return { ...first, ...second }; }
const lines: string[] = [];
for (let round = 0; round < 2; round++) {
  for (let i = 0; i < sources.length; i++) {
    const s = sources[i];
    lines.push(i + " " + show(two({ z: 0 }, s)));
  }
}
console.log(lines.join("|"));
console.log(log.length);
