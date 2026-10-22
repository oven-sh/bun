// IR+ ^ .* = JSONSourceOpen v
const namedInCode = ["x", "y", "label", "children", "text", "value", "t"];
console.log(namedInCode.length);
interface Point {
  x: number;
  y: number;
}
interface Tree {
  label: string;
  children: Tree[];
}
const beginningsSeen = new Set<string>();
function letSixteenGoBy(text: string) {
  const beginning = text.slice(0, 8);
  if (beginningsSeen.has(beginning) || text.length > 10000) return;
  beginningsSeen.add(beginning);
  for (let turn = 0; turn < 16; turn++) {
    try {
      JSON.parse(text);
    } catch {}
  }
}
function point(text: string): Point {
  letSixteenGoBy(text);
  return JSON.parse(text);
}
function points(text: string): Point[] {
  letSixteenGoBy(text);
  return JSON.parse(text);
}
function tree(text: string): Tree {
  letSixteenGoBy(text);
  return JSON.parse(text);
}
function show(label: string, value: unknown) {
  console.log(label + ":", JSON.stringify(value), value !== null && typeof value === "object" && !Array.isArray(value) ? Reflect.ownKeys(value).map(String).join() : "");
}
show("one key more", point('{"x":1,"y":2,"z":3}'));
show("the same again", point('{"x":1,"y":2,"z":3}'));
show("without it", point('{"x":1,"y":2}'));
show("it comes first", point('{"z":3,"x":1,"y":2}'));
show("it comes twice", point('{"z":3,"x":1,"z":4,"y":2}'));
show("it is escaped", point('{"x":1,"\\u007a":5,"y":2}'));
show("escaped after plain", point('{"z":3,"x":1,"\\u007a":5,"y":2}'));
show("it holds an object", point('{"x":1,"y":2,"z":{"x":1,"y":{"z":[{"x":2}]}}}'));
show("its prefix", point('{"x":1,"y":2,"zz":3,"":4,"z":5}'));
const orders = ["xyzw", "xywz", "xzyw", "xzwy", "xwyz", "xwzy", "yxzw", "wzyx", "zwxy", "xyzw", "wzyx"];
for (const order of orders) show("order " + order, point("{" + [...order].map((name, at) => JSON.stringify(name) + ":" + at).join(",") + "}"));
let many = '{"x":0,"y":0';
for (let i = 0; i < 100; i++) {
  many += ',"k' + i + '":' + i;
  const value = point(many + "}") as unknown as Record<string, number>;
  if (Object.keys(value).length !== i + 3 || value["k" + i] !== i || Object.keys(value)[i + 2] !== "k" + i) console.log("WRONG at", i);
}
show("after a hundred keys", point('{"x":1,"y":2,"k99":3,"k0":4,"new":5}'));
for (const name of ["__proto__", "constructor", "toString", "0", "1e3", "-1", "4294967294", "4294967295", "é", "中", "a b", " ", "\\\\", "\\\""]) {
  const text = '{"x":1,"' + name + '":{"deep":true},"y":2}';
  const value = point(text);
  show("named " + JSON.stringify(name), value);
  show("again", point(text));
  console.log(Object.getPrototypeOf(value) === Object.prototype, (value as any).deep);
}
show("in a tree", tree('{"label":"a","children":[{"label":"b","children":[],"more":1},{"extra":{"label":"no tree"},"label":"c","children":[{"children":[],"label":"d","more":2,"other":3}]}],"more":0}'));
show("in a tree again", tree('{"label":"a","children":[{"label":"b","children":[],"more":1}],"other":[1]}'));
let list = "[";
for (let i = 0; i < 300000; i++) list += (i ? "," : "") + '{"x":' + i + ',"y":' + (i % 7) + (i % 3 ? "" : ',"t":"' + (i % 1000) + '"') + "}";
const parsed = points(list + "]") as (Point & { t?: string })[];
let sum = 0;
for (let i = 0; i < parsed.length; i++) sum = (sum + parsed[i]!.x * 31 + parsed[i]!.y + (parsed[i]!.t?.length ?? 0) + Object.keys(parsed[i]!).length) % 1000003;
console.log(parsed.length, sum);
