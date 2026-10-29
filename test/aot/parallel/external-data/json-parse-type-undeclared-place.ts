// Undeclared keys stand before, between and behind the declared ones, once and many times over. The result is what JSON.parse(text) gives.
interface Point { x: number; y: number; label?: string }
interface Segment { id: number; from: Point; to: Point; note?: string; tags: string[] }
interface Named { id: number; name: string }
interface Numbered { id: number }
interface Bag { id: number; [key: string]: number | string }
interface Wide { a: number; b: string; c: boolean; d: number | null; e?: number; f?: string; g: number[]; h: Numbered }

function show(value: any): string {
  if (Array.isArray(value)) return "[" + value.map(show).join(",") + "]";
  if (typeof value !== "object" || value === null) return Object.is(value, -0) ? "-0" : typeof value + ":" + String(value);
  const inLoop: string[] = [];
  for (const key in value) inLoop.push(key);
  const described = Object.getOwnPropertyNames(value).map(key => {
    const found = Object.getOwnPropertyDescriptor(value, key)!;
    return JSON.stringify(key) + (found.writable && found.enumerable && found.configurable ? "" : "!") + "=" + show(found.value);
  });
  return "{" + described.join(",") + "|" + inLoop.join() + "|" + Object.keys(value).join() + "|" + JSON.stringify(Object.entries(value).map(entry => entry[0])) + "|" + (Object.getPrototypeOf(value) === Object.prototype) + "|" + JSON.stringify(value) + "|" + JSON.stringify({ ...value }) + "}";
}

function attempt(parse: (text: string) => unknown, text: string, then?: (value: any) => void): string {
  try {
    const value = parse(text);
    then?.(value);
    return show(value);
  } catch (error: any) {
    return "throws " + error.name;
  }
}

function check(label: string, texts: string[], parse: (text: string) => unknown, then?: (value: any) => void): void {
  let different = 0;
  for (let round = 0; round < 3; round++) {
    for (const text of texts) {
      const typed = attempt(parse, text, then);
      const plain = attempt(globalThis.JSON.parse, text, then);
      if (typed !== plain && different++ < 3) console.log(label + " DIFFERS on " + text + "\n  " + typed + "\n  " + plain);
    }
  }
  console.log(label + ": " + texts.length + " texts, " + different + " differ");
}

function orders<T>(items: T[]): T[][] {
  if (items.length < 2) return [items];
  return items.flatMap((item, at) => orders([...items.slice(0, at), ...items.slice(at + 1)]).map(rest => [item, ...rest]));
}

const asObject = (members: string[]) => "{" + members.join(",") + "}";
const point = (text: string) => JSON.parse(text) as Point;
const segment = (text: string) => JSON.parse(text) as Segment;

check("every order of two members and three others", orders(['"x":1', '"y":2', '"p":3', '"q":"four"', '"r":null']).map(asObject), point);
check("every order with the optional member", orders(['"x":1', '"y":2', '"label":"l"', '"p":[1,{"a":2}]', '"q":{"b":{"c":[]}}']).map(asObject), point);
check("every order of the members alone", orders(['"x":1', '"y":2', '"label":"l"']).map(asObject), point);

const values = ["0", "-0", "1.5", "-1e3", "1e400", "123456789012345678901234567890", '""', '"a\\nb"', '"\\u00e9"', '"é"', '"日本"', "true", "false", "null", "[]", "{}", "[[],{}]", '{"x":1,"y":2}', '{"__proto__":1}', '"' + "long ".repeat(60) + '"'];
check("values of every kind", values.flatMap(value => [`{"x":1,"y":2,"o":${value}}`, `{"o":${value},"x":1,"y":2}`, `{"x":1,"o":${value},"y":2,"p":${value}}`]), point);

const many: string[] = [];
for (let count = 1; count <= 140; count += count < 20 ? 1 : 13) {
  const others = Array.from({ length: count }, (_, at) => `"k${at}":${at}`);
  many.push(asObject(['"x":1', '"y":2', ...others]), asObject([...others, '"x":1', '"y":2']), asObject(['"x":1', ...others.slice(0, count >> 1), '"y":2', ...others.slice(count >> 1)]));
}
check("from one to many", many, point);

const names = ["toString", "constructor", "hasOwnProperty", "valueOf", "__proto__", "__defineGetter__", "toJSON", "then", "length", "prototype", "", " ", "0", "1", "42", "-1", "01", "1.5", "4294967294", "4294967295", "9007199254740993", "é", "日本", "😀", "a b", "a-b", "x ", "X", "label ", "n".repeat(27), "n".repeat(28), "n".repeat(29), "n".repeat(30), "n".repeat(48), "n".repeat(49), "n".repeat(300)];
check("names of every kind", names.flatMap(name => [`{"x":1,"y":2,${JSON.stringify(name)}:7}`, `{${JSON.stringify(name)}:7,"x":1,"y":2}`, `{"x":1,${JSON.stringify(name)}:{"a":1},"y":2,"z":3}`]), point);
check("names written with escapes", ['{"x":1,"y":2,"\\u0061":3}', '{"\\u0078":1,"y":2}', '{"x":1,"y":2,"a\\nb":3}', '{"x":1,"y":2,"a\\"b":3}', '{"x":1,"\\u0079":5,"y":2}', '{"x":1,"y":2,"lab\\u0065l":"l"}', '{"x":1,"y":2,"\\ud83d\\ude00":1}'], point);

check("twice", ['{"x":1,"y":2,"o":1,"o":2}', '{"o":1,"x":1,"o":2,"y":2}', '{"x":1,"x":3,"y":2,"o":1}', '{"x":1,"o":1,"y":2,"x":3}', '{"o":1,"p":2,"o":3,"x":1,"y":2,"p":4}', '{"x":1,"y":2,"label":"a","o":1,"label":"b"}', '{"x":"no","o":1,"x":1,"y":2}', '{"x":1,"y":2,"o":{"a":1,"a":2}}'], point);

const spaced = ['{"x":1,"y":2,"o":3}', '{"o":[1,2],"x":1,"p":{"a":1},"y":2}', '{"x":1,"label":"l","o":1,"p":2,"y":2,"q":3}'];
check("with whitespace", spaced.flatMap(text => [JSON.stringify(globalThis.JSON.parse(text), null, 2), JSON.stringify(globalThis.JSON.parse(text), null, "\t"), text.replaceAll(":", " : ").replaceAll(",", " ,\r\n "), " " + text + "\n"]), point);
check("in 16-bit text", spaced.map(text => text.replace("}", ',"wide":"日本","Ω":1}')), point);
check("what is no JSON", ['{"x":1,"y":2,"o":}', '{"x":1,"y":2,"o"}', '{"x":1,"y":2,"o":1,}', '{"x":1,"y":2,o:1}', '{"x":1,"y":2,"o":1', '{"x":1,"y":2,"o":[1,}', '{"x":1,"y":2,"o":01}', '{"x":1,"y":2,"o":"a\nb"}', '{"x":1,"y":2,"o":tru}', '{"x":1,"y":2,"o":1 "p":2}', '{"x":1,"y":2,"o":1}}', '{"x":1,"y":2,"o' ], point);

const inner = ['{"x":1,"y":2}', '{"x":1,"y":2,"o":1}', '{"o":1,"y":2,"x":1}', '{"y":2,"p":[],"x":1,"label":"l","q":{}}'];
check("at every level", inner.flatMap(from => inner.flatMap(to => [`{"id":1,"from":${from},"to":${to},"tags":[]}`, `{"a":1,"id":1,"b":2,"to":${to},"c":${from},"from":${from},"tags":["t"],"d":4}`, `{"tags":[],"to":${to},"note":"n","from":${from},"id":1,"z":{"from":${from}}}`])), segment);

const turns: string[] = [];
for (let i = 0; i < 12; i++) turns.push(`{"id":${i},"name":"n${i}"}`, `{"name":"n","id":${i},"more":1}`, `{"id":${i},"more":1,"name":"n"}`);
let turn = 0;
check("a name that one type declares and another does not", turns, text => (turn++ & 1 ? (JSON.parse(text) as Named) : JSON.parse(text) as Numbered));

check("an index signature", ['{"id":1}', '{"id":1,"a":2,"b":"c"}', '{"a":2,"id":1,"b":"c"}', '{"a":2,"a":3,"id":1}', '{"0":1,"id":1,"a":2}', '{"id":1,"__proto__":3}'], text => JSON.parse(text) as Bag);

const wide = ['"a":1', '"b":"two"', '"c":true', '"d":null', '"g":[1,2]', '"h":{"id":1,"o":1}'];
const wider: string[] = [];
for (let at = 0; at <= wide.length; at++) {
  for (const more of [['"o":1'], ['"e":5'], ['"f":"f"', '"o":1'], ['"o":1', '"p":2', '"e":5'], ['"f":"f"', '"e":5']]) wider.push(asObject([...wide.slice(0, at), ...more, ...wide.slice(at)]), asObject([...wide.slice(at), ...more, ...wide.slice(0, at)]));
}
check("eight members of several kinds", wider, text => JSON.parse(text) as Wide);

const changes: [string, (value: any) => void][] = [
  ["a new key", value => { value.added = 1; }],
  ["an undeclared key goes", value => { delete value.o; }],
  ["an undeclared key goes and comes back", value => { delete value.o; value.o = 9; }],
  ["the optional member goes", value => { delete value.label; }],
  ["the optional member comes", value => { value.label = "late"; }],
  ["a member goes and comes back", value => { delete value.x; value.x = 9; }],
  ["an undeclared key is written", value => { value.o = "new"; value.p = "newer"; }],
  ["frozen", value => { Object.freeze(value); }],
  ["an index key comes", value => { value[3] = 1; value[1] = 2; }],
  ["an accessor comes", value => { Object.defineProperty(value, "o", { get: () => 5, enumerable: true, configurable: true }); }],
];
for (const [label, change] of changes) check("afterwards: " + label, ['{"x":1,"y":2}', '{"x":1,"y":2,"o":3}', '{"o":3,"x":1,"p":4,"y":2}', '{"x":1,"o":3,"label":"l","y":2,"p":4,"q":5}'], point, change);

const sets: string[] = [];
let seed = 1;
for (let i = 0; i < 600; i++) {
  const members = ['"x":1'];
  for (let k = 0; k < 14; k++) {
    seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
    if (seed & 0x10000) members.push(`"name${k}":${k % 3 ? k : '"v' + k + '"'}`);
    if (k === 6) members.push('"y":2');
  }
  sets.push(asObject(members));
}
check("many sets of undeclared keys in turn", sets, point);

const between: string[] = [];
for (const count of [1, 2, 3, 63, 64, 65, 126, 127, 128, 129, 130, 131, 132, 133, 200, 513, 1200, 5000]) {
  const others = Array.from({ length: count }, (_, at) => `"k${at}":${at}`);
  between.push(asObject(['"x":1', ...others, '"y":2', '"m0":0']), asObject([...others, '"x":1', '"m0":0', '"y":2', '"m1":1']), asObject(['"a":0', '"x":1', ...others, '"label":"l"', '"m0":0', '"y":2']));
}
check("a few and very many between the members", between, point);

const kept: Point[] = [];
const texts: string[] = [];
for (let i = 0; i < 3000; i++) {
  const text = `{"x":${i},"k${i % 7}":"${"v".repeat(i % 50)}","y":${-i},"list":[${i},{"deep":"${i}"}]${i % 3 ? "" : ',"label":"l' + i + '"'},"last":${i % 2 ? "null" : '{"a":' + i + "}"}}`;
  texts.push(text);
  kept.push(JSON.parse(text) as Point);
}
let changed = 0;
for (let i = 0; i < kept.length; i++) changed += Number(show(kept[i]) !== show(globalThis.JSON.parse(texts[i])));
console.log("kept for a while: " + kept.length + " objects, " + changed + " differ");
