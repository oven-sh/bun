// The declared keys of an object come in every order, with and without white space, again and again. The result is what JSON.parse(text) gives.
interface Point { x: number; y: number; label?: string }
interface Four { a: number; b: string; c: boolean; d?: number | null }
interface FirstThenSecond { first: number; second: number }
interface SecondThenFirst { second: number; first: number }
interface Thirteen { k0: number; k1: number; k2: number; k3: number; k4: number; k5: number; k6: number; k7: number; k8: number; k9: number; k10: number; k11: number; k12: number }
interface Fourteen extends Thirteen { k13: number }
interface Holder { id: number; points: Point[]; last: Point; four?: Four }
interface AllOptional { p?: number; q?: number }

function show(value: any): string {
  if (Array.isArray(value)) return "[" + value.map(show).join(",") + "]";
  if (typeof value !== "object" || value === null) return Object.is(value, -0) ? "-0" : typeof value + ":" + String(value);
  const inLoop: string[] = [];
  for (const key in value) inLoop.push(key);
  return "{" + Object.getOwnPropertyNames(value).map(key => JSON.stringify(key) + "=" + show(value[key])).join(",") + "|" + inLoop.join() + "|" + Object.keys(value).join() + "|" + JSON.stringify(value) + "}";
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

function check(label: string, texts: string[], parse: (text: string) => unknown, then?: (value: any) => void, plainly: (text: string) => unknown = JSON.parse): void {
  let different = 0;
  for (let round = 0; round < 5; round++) {
    for (const text of texts) {
      const typed = attempt(parse, text, then);
      const plain = attempt(plainly, text, then);
      if (typed !== plain && different++ < 3) console.log(label + " DIFFERS on " + text + "\n  " + typed + "\n  " + plain);
    }
  }
  console.log(label + ": " + texts.length + " texts, " + different + " differ");
}

function refuse(text: string): never {
  throw new TypeError(text);
}

function orders<T>(items: T[]): T[][] {
  if (items.length < 2) return [items];
  return items.flatMap((item, at) => orders([...items.slice(0, at), ...items.slice(at + 1)]).map(rest => [item, ...rest]));
}

const asObject = (members: string[]) => "{" + members.join(",") + "}";
const spaced = (members: string[]) => "{ " + members.map(member => member.replace(":", ": ")).join(", ") + " }";
const onLines = (members: string[]) => "{\n" + members.map(member => "\t" + member.replace(":", " :\r\n ")).join(" ,\n") + "\n}";
const point = (text: string) => JSON.parse<Point>(text);
const four = (text: string) => JSON.parse<Four>(text);

const ofFour = ['"a":1', '"b":"two"', '"c":true', '"d":null'];
check("every order of four", orders(ofFour).map(asObject), four);
check("every order of three of four", orders(ofFour.slice(0, 3)).map(asObject), four);
check("every order of four, spaced", orders(ofFour).map(spaced), four);
check("every order of four, on lines", orders(ofFour).map(onLines), four);
check("one is missing", orders(ofFour.slice(1)).map(asObject), four, undefined, refuse);
check("one is wrong", orders(['"a":"1"', '"b":"two"', '"c":true']).map(asObject), four, undefined, refuse);
check("one comes twice", orders(['"a":1', '"b":"two"', '"c":true', '"a":4']).map(asObject), four);
check("the optional one comes twice", orders(['"a":1', '"b":"two"', '"c":true', '"d":4', '"d":null']).map(asObject), four);

check("with and without an undeclared key, in turn", [
  '{"x":1,"y":2}', '{"o":1,"x":1,"y":2}', '{ "x": 1, "y": 2 }', '{"y":2,"x":1}', '{"o":1,"y":2,"x":1}', '{"y":2,"o":1,"x":1}', '{"y":2,"x":1,"o":1}', '{"y":2,"x":1}',
  '{"label":"l","y":2,"x":1}', '{"label":"l","o":1,"y":2,"x":1}', '{"label":"l","y":2,"x":1}', '{"y":2,"label":"l","x":1}', '{"0":1,"y":2,"x":1}', '{"y":2,"x":1,"__proto__":null}', '{"y":2,"x":1}',
], point);

const pairs = ['{"first":1,"second":2}', '{"second":2,"first":1}', '{ "first": 1, "second": 2 }', '{ "second": 2, "first": 1 }'];
check("two types of the same members, the one", pairs, text => JSON.parse<FirstThenSecond>(text));
check("two types of the same members, the other", pairs, text => JSON.parse<SecondThenFirst>(text));
check("two types of the same members, in turn", pairs, text => [JSON.parse<FirstThenSecond>(text), JSON.parse<SecondThenFirst>(text), JSON.parse<FirstThenSecond>(text)], undefined, text => [JSON.parse(text), JSON.parse(text), JSON.parse(text)]);

const numbered = (count: number) => Array.from({ length: count }, (_, i) => `"k${i}":${i}`);
const turns = (members: string[]) => members.map((_, at) => [...members.slice(at), ...members.slice(0, at)]).flatMap(turned => [turned, [...turned].reverse()]);
check("thirteen members", turns(numbered(13)).map(asObject), text => JSON.parse<Thirteen>(text));
check("fourteen members", turns(numbered(14)).map(asObject), text => JSON.parse<Fourteen>(text));
check("thirteen members and one more key", turns(numbered(14)).map(asObject), text => JSON.parse<Thirteen>(text));
check("none, one or both of two optional members", ["{}", "{ }", '{"p":1}', '{"q":1}', '{"p":1,"q":2}', '{"q":2,"p":1}', '{"o":0}'], text => JSON.parse<AllOptional>(text));

const inner = ['{"x":1,"y":2}', '{"y":2,"x":1}', '{"label":"l","x":1,"y":2}', '{ "y": 2, "label": "l", "x": 1 }'];
check("objects within objects", orders(['"id":1', `"points":[${inner.join(",")}]`, `"last":${inner[1]}`, `"four":${asObject([...ofFour].reverse())}`]).flatMap(members => [asObject(members), spaced(members)]), text => JSON.parse<Holder>(text));

const changes: [string, (value: any) => void][] = [
  ["a member is deleted and written again", value => { delete value.x; value.x = 5; }],
  ["the optional member is written", value => { value.label = "late"; }],
  ["another key is written", value => { value.o = 1; }],
  ["a member is written", value => { value.y = 7; }],
  ["frozen", value => { Object.freeze(value); }],
];
for (const [label, change] of changes) check("afterwards: " + label, ['{"x":1,"y":2}', '{"y":2,"x":1}', '{"y":2,"label":"l","x":1}', '{ "x": 1, "y": 2 }'], point, change);

const kept: Four[] = [];
const texts: string[] = [];
const all = orders(ofFour);
for (let i = 0; i < 4000; i++) {
  const text = (i % 3 ? asObject : spaced)(all[i % all.length].map(member => member.replace('"two"', '"' + "t".repeat(i % 40) + '"').replace(":1", ":" + i)));
  texts.push(text);
  kept.push(JSON.parse<Four>(text));
}
let changed = 0;
for (let i = 0; i < kept.length; i++) changed += Number(show(kept[i]) !== show(JSON.parse(texts[i])));
console.log("kept for a while: " + kept.length + " objects, " + changed + " differ");
