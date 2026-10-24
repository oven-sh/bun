// Every cache with a cap is filled from below the cap to above it in the middle of a parse, a write or a conversion of an object that stands on one of its entries. Argument: the number of a road; none: all.
import { validate } from "bun:bundle";
interface Item { id: number }
interface Holder { first: number; items: Item[]; last: string }
interface Pair { left: Item; right: Item }
interface Deep { name: string; below: Deep[]; item: Item }
type Tagged = { kind: "a"; a: number } | { kind: "b"; b: number } | { kind: "c"; c: number };
interface Tags { first: number; items: Tagged[]; last: string }

const plainParse: (text: string) => any = JSON.parse;
const counts = [10, 255, 256, 257, 4095, 4096, 4097, 16383, 16384, 16385, 20000, 33000];
let serial = 0;

function holderText(items: string[]): string {
  return '{"a":"before","first":1,"b":[1,2],"items":[' + items.join(",") + '],"c":"behind","last":"l","d":{"e":null},"f":"' + "x".repeat(40) + '"}';
}
function kinds(count: number, make: (unique: number, at: number) => string): string[] {
  const items: string[] = [];
  for (let at = 0; at < count; at++) items.push(make(++serial, at));
  return items;
}
function deepText(levels: number, width: number): string {
  const unique = ++serial;
  return '{"u' + unique + '":1,"name":"n","below":[' + (levels ? Array.from({ length: width }, () => deepText(levels - 1, width)).join(",") : "") + '],"item":{"id":1,"v' + unique + '":2},"w' + unique + '":3}';
}

const roads: [string, (count: number) => boolean][] = [
  ["the writer's plans", count => {
    const text = holderText(kinds(count, (unique, at) => '{"id":' + at + ',"k' + unique + '":' + at + "}"));
    const holder = JSON.parse<Holder>(text);
    return JSON.stringify(holder) === text && JSON.stringify(holder) === text && JSON.stringify([holder, holder]) === "[" + text + "," + text + "]" && JSON.stringify({ h: holder }) === '{"h":' + text + "}";
  }],
  ["the writer's plans, three keys in other orders", count => {
    const text = holderText(kinds(count, (unique, at) => '{"p' + unique + '":1,"id":' + at + ',"q' + unique + '":"two","r' + unique + '":[3]}'));
    const holder = JSON.parse<Holder>(text);
    return JSON.stringify(holder) === text && JSON.stringify(holder.items) === text.slice(text.indexOf("[{"), text.indexOf("}]") + 2) && JSON.stringify(holder) === text;
  }],
  ["key orders, each text parsed three times", count => {
    const text = holderText(kinds(count, (unique, at) => (at % 2 ? '{"k' + unique + '":1,"id":' + at + "}" : '{"id":' + at + ',"k' + unique + '":1,"m":2}')));
    let good = true;
    for (let round = 0; round < 3; round++) good = JSON.stringify(JSON.parse<Holder>(text)) === text && good;
    return good;
  }],
  ["known members, runs of three, each text parsed four times", count => {
    const text = holderText(kinds(count, (unique, at) => '{"id":' + at + ',"a' + unique + '":1,"b' + unique + '":"two","c' + unique + '":[3]}'));
    let good = true;
    for (let round = 0; round < 4; round++) good = JSON.stringify(JSON.parse<Holder>(text)) === text && good;
    return good;
  }],
  ["known members that fall on the same places", count => {
    const items = kinds(Math.min(count, 20000), (unique, at) => '{"id":' + at + ',"aa' + (unique % 97) + '":1,"aa' + (unique % 89) + 'x":2,"aa' + unique + '":3}');
    const text = holderText(items);
    let good = true;
    for (let round = 0; round < 4; round++) good = JSON.stringify(JSON.parse<Holder>(text)) === JSON.stringify(plainParse(text)) && good;
    return good;
  }],
  ["conversions of plain objects: validate", count => {
    const text = holderText(kinds(count, (unique, at) => '{"k' + unique + '":1,"id":' + at + "}"));
    return JSON.stringify(validate<Holder>(plainParse(text))) === text && JSON.stringify(validate<Holder>(plainParse(text))) === text;
  }],
  ["conversions of plain objects: the parser gives up", count => {
    const text = holderText(kinds(count, (unique, at) => '{"k' + unique + '":1,"id":' + at + "}"));
    return JSON.stringify(JSON.parse<Holder>(text.replace('"first"', '"\\u0066irst"'))) === text;
  }],
  ["conversions by a tag", count => {
    const text = holderText(kinds(count, (unique, at) => ['{"k' + unique + '":1,"kind":"a","a":1}', '{"kind":"b","k' + unique + '":1,"b":2}', '{"c":3,"kind":"c","k' + unique + '":1}'][at % 3]));
    return JSON.stringify(validate<Tags>(plainParse(text))) === text && JSON.stringify(JSON.parse<Tags>(text)) === text && JSON.stringify(JSON.parse<Tags>(text.replace('"first"', '"\\u0066irst"'))) === text;
  }],
  ["copies of typed objects", count => {
    const text = holderText(kinds(count, (unique, at) => '{"id":' + at + ',"k' + unique + '":' + at + "}"));
    const holder = JSON.parse<Holder>(text);
    const copy = validate<Holder>(holder);
    const spread = { ...holder, items: holder.items.map(item => ({ ...item })) };
    return JSON.stringify(copy) === text && JSON.stringify(spread) === text && JSON.stringify(holder) === text;
  }],
  ["a tree whose every record has keys of its own", count => {
    const levels = count < 300 ? 3 : count < 5000 ? 6 : count < 20000 ? 7 : 8;
    const text = deepText(levels, 3);
    const deep = JSON.parse<Deep>(text);
    return JSON.stringify(deep) === text && JSON.stringify(validate<Deep>(plainParse(text))) === text && JSON.stringify(validate<Deep>(deep)) === text && JSON.stringify(JSON.parse<Deep>(text)) === text;
  }],
  ["shapes learned by JSON.parse without a type", count => {
    const size = Math.min(count, 5000);
    const text = holderText(kinds(size, (unique, at) => '{"id":' + at + ',"s' + (unique % (size + 3)) + '":{"t' + (unique % 19) + '":[{"u' + (unique % 301) + '":1}]}}'));
    const written = JSON.stringify(plainParse(text));
    let good = true;
    for (let round = 0; round < 40; round++) good = JSON.stringify(JSON.parse(text)) === written && good;
    return good;
  }],
  ["shapes expected by an annotated variable", count => {
    const size = Math.min(count, 5000);
    const text = holderText(kinds(size, (unique, at) => '{"id":' + at + ',"s' + (unique % (size + 3)) + '":{"t' + (unique % 19) + '":1}}'));
    let good = true;
    for (let round = 0; round < 40; round++) {
      const holder: Holder = JSON.parse(text);
      good = holder.items.length === size && JSON.stringify(holder) === text && good;
    }
    return good;
  }],
  ["many small texts, each of a kind of its own", count => {
    let good = true;
    for (let at = 0; at < count; at++) {
      const unique = ++serial;
      const text = '{"left":{"id":1,"l' + unique + '":1},"m' + unique + '":{"n":2},"right":{"r' + unique + '":[3],"id":2}}';
      const pair = JSON.parse<Pair>(text);
      good = JSON.stringify(pair) === text && JSON.stringify(validate<Pair>(pair)) === text && Object.keys(pair).length === 3 && good;
    }
    return good;
  }],
];

const only = Number((globalThis as any).arguments?.[0] ?? -1);
roads.forEach(([label, run], at) => {
  if (only >= 0 && only !== at) return;
  const wrong = counts.filter(count => !run(count));
  console.log(label + ": " + counts.length + " counts: " + wrong.length + " differ" + (wrong.length ? " (" + wrong.join() + ")" : ""));
});
