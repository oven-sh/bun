// While an outer object is still being parsed, with undeclared keys of its own in front of and behind the member, the objects inside it change what the parser has learned: the first object of the same type that spills, and more orders of keys than are remembered. Nothing is written: the keys and values are walked.
interface Self { name: string; inner?: Self; list?: Self[] }
interface Item { id: number }
interface Holder { first: number; items: Item[]; last: string }
interface Other1 { name: string; inner?: Other1 }
interface Other2 { name: string; inner?: Other2 }
interface Other3 { name: string; inner?: Other3 }

const plainParse: (text: string) => any = globalThis.JSON.parse;
function walk(value: any): string {
  if (Array.isArray(value)) {
    let said = "[";
    for (const item of value) said += walk(item) + ",";
    return said + "]";
  }
  if (typeof value !== "object" || value === null) return String(value);
  let said = "{";
  for (const key of Object.keys(value)) said += key + ":" + walk(value[key]) + ",";
  return said + "}";
}
let serial = 0;
const extras = (prefix: string, count: number): string[] => Array.from({ length: count }, (_, at) => '"' + prefix + at + '":"value number ' + ++serial + ' is longer than any short string that is cached"');
function selfText(levels: number, inside: number, around: number): string {
  if (levels === 0) return "{" + ['"name":"leaf"', ...extras("i", inside)].join(",") + "}";
  return "{" + [...extras("a", around), '"name":"n' + levels + '"', '"inner":' + selfText(levels - 1, inside, around), ...extras("b", around)].join(",") + "}";
}
function check(label: string, parse: (text: string) => unknown, texts: string[]): void {
  let different = 0;
  for (const text of texts) for (let round = 0; round < 3; round++) if (walk(parse(text)) !== walk(plainParse(text))) different++;
  console.log(label + ": " + texts.length + " texts: " + different + " differ");
}
check("the first object that spills lies inside", text => JSON.parse(text) as Self, [selfText(1, 70, 3)]);
check("then others", text => JSON.parse(text) as Self, [1, 2, 3, 5].flatMap(levels => [0, 1, 2, 3, 4, 63, 64, 65, 70, 127, 128, 129, 200].flatMap(inside => [0, 1, 3, 40].map(around => selfText(levels, inside, around)))));
check("deeper first", text => JSON.parse(text) as Other1, [selfText(6, 65, 2), selfText(6, 3, 2), selfText(2, 130, 70)]);
check("many around, few inside", text => JSON.parse(text) as Other2, [selfText(3, 1, 70), selfText(3, 70, 1), selfText(3, 64, 64)]);
check("growing", text => JSON.parse(text) as Other3, Array.from({ length: 140 }, (_, count) => selfText(2, count, count >> 1)));
check("lists of itself", text => JSON.parse(text) as Self, [3, 70, 130].map(inside => "{" + [...extras("a", 3), '"name":"n"', '"list":[' + [selfText(0, inside, 0), selfText(1, inside, 2), selfText(0, 1, 0)].join(",") + "]", ...extras("b", 3)].join(",") + "}"));

for (const count of [10, 4096, 16383, 16384, 16385, 20000, 40000]) {
  const items: string[] = [];
  for (let at = 0; at < count; at++) items.push(at % 2 ? '{"k' + ++serial + '":1,"id":' + at + "}" : '{"id":' + at + ',"k' + ++serial + '":1,"m":2}');
  check(count + " orders inside an open holder", text => JSON.parse(text) as Holder, ['{"a":"before","first":1,"b":[1,2],"items":[' + items.join(",") + '],"c":"behind","last":"l","d":{"e":null}}']);
}
