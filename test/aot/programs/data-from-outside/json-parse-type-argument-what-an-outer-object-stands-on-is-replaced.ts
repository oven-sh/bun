// Something is emptied, grown or replaced while an outer object of the same parse still stands on it.
interface Node { id: number; below: Node | null; name: string }
interface Item { id: number }
interface Holder { first: number; items: Item[]; last: string }
let different = 0;
let compared = 0;
function check<T>(parse: (text: string) => T, text: string): void {
  compared++;
  const [typed, plain] = [parse(text), JSON.parse(text)];
  if (JSON.stringify(Object.keys(typed as object)) !== JSON.stringify(Object.keys(plain)) || JSON.stringify(typed) !== JSON.stringify(plain)) different++;
}
const others = (prefix: string, count: number, value: (at: number) => string) => Array.from({ length: count }, (_, at) => `"${prefix}${at}":${value(at)}`);
const fresh = (at: number) => `"${"v".repeat(40)}${at}"`;
let serial = 0;
for (const inner of [1, 2, 3, 5, 31, 32, 33, 63, 64, 65, 70, 127, 128, 129, 200]) {
  for (let round = 0; round < 3; round++) {
    const deepest = `{${[...others("i" + serial++ + "_", inner, fresh), '"id":3', '"below":null', '"name":"c"'].join(",")}}`;
    const middle = `{${[...others("m", 3, fresh), '"id":2', ...others("n", 2, fresh), `"below":${deepest}`, ...others("o", inner % 7, fresh), '"name":"b"'].join(",")}}`;
    check(text => JSON.parse<Node>(text), `{${[...others("a", 3, fresh), '"id":1', `"below":${middle}`, ...others("b", 3, fresh), '"name":"a"', ...others("c", 2, fresh)].join(",")}}`);
  }
}
for (const count of [10, 300, 5000, 16383, 16384, 16385, 17000, 34000]) {
  const items = Array.from({ length: count }, (_, at) => (at % 2 ? `{"k${++serial}":1,"id":${at}}` : `{"id":${at},"k${++serial}":1,"m":2}`));
  const text = `{"a":"before","first":1,"b":[1,2],"items":[${items.join(",")}],"c":"behind","last":"l","d":{"e":null}}`;
  for (let round = 0; round < 2; round++) {
    compared++;
    const holder = JSON.parse<Holder>(text);
    if (Object.keys(holder).join() !== "a,first,b,items,c,last,d" || holder.items.length !== count || Object.keys(holder.items[count - 1]).join() !== Object.keys(JSON.parse(items[count - 1])).join()) different++;
  }
}
console.log(compared + " compared, " + different + " differ");
