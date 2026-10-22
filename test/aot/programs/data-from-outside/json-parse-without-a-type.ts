// JSON.parse(text) that goes to no declared type learns the keys from the texts it sees, place by place. Whatever it has learned, the result is what JSON.parse makes of the text.
function describe(value: unknown): string {
  if (value === null || typeof value !== "object") return typeof value + ":" + (Object.is(value, -0) ? "-0" : String(value));
  if (Array.isArray(value)) return "[" + value.map(describe).join() + "]";
  return "{" + Reflect.ownKeys(value).map(key => String(key) + "=" + describe((value as Record<string, unknown>)[key as string])).join() + "}" + (Object.getPrototypeOf(value) === Object.prototype ? "" : "!");
}
let checksum = 0;
let count = 0;
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
function check(text: string) {
  letSixteenGoBy(text);
  let seen: string;
  try {
    seen = describe(JSON.parse(text));
  } catch (error) {
    seen = (error as Error).name + ": " + (error as Error).message;
  }
  for (let i = 0; i < seen.length; i++) checksum = (checksum * 31 + seen.charCodeAt(i)) % 1000000007;
  count++;
}
function report(label: string) {
  console.log(label + ":", count, checksum);
}

for (let round = 0; round < 3; round++) {
  for (let kind = 0; kind < 40; kind++) check('{"kind' + kind + '":' + kind + ',"shared":"s","list":[{"a' + kind + '":1,"b":[' + kind + ']},{"b":[],"a' + kind + '":2}]}');
}
report("forty kinds of object at the root");

for (let round = 0; round < 3; round++) {
  let text = "{";
  for (let i = 0; i < 120; i++) text += (i ? "," : "") + '"user' + (i * 7 + round) + '":{"id":' + i + ',"name":"n' + (i % 5) + '"}';
  check(text + "}");
}
report("objects used as dictionaries");

const atOnePlace = ['{"v":1}', '{"v":"s"}', '{"v":null}', '{"v":{"x":1}}', '{"v":[1,2]}', '{"v":{"y":2}}', '{"v":[{"x":1}]}', '{"v":[[{"x":1}]]}', '{"v":true}', '{"v":{"x":{"x":{"x":[]}}}}', '{"v":[]}', '{"v":{}}', '{"v":-0}', '{"v":1e400}', '{"v":[{"x":1},[2],"3",{"y":4},null]}'];
for (let round = 0; round < 4; round++) for (const text of atOnePlace) check(text);
report("every kind of value at one place");

for (let i = 0; i < 400; i++) check('{"outer' + (i % 3) + '":{"inner' + i + '":{"leaf' + i + '":[{"deep' + i + '":' + i + "}]}}}");
for (let i = 399; i >= 0; i--) check('{"outer' + (i % 3) + '":{"inner' + i + '":{"leaf' + i + '":[{"deep' + i + '":' + i + "}]}}}");
report("more shapes than are kept");

const roots = ["[]", "{}", "[[]]", "[{}]", '"text"', "0", "-0", "null", "true", " [ 1 , 2 ] ", '\t{\n"a"\r:\n1\n}\n', "[1,2", '{"a":1', '{"a":1,}', "[1,]", '{"a" 1}', '{"a":1 "b":2}', "{,}", "[,]", '{"a":}', "", " ", "nul", "tru", "01", "1.", ".5", "+1", "1e", "0x10", "'a'", '{"a":1}}', "[1]]", '{"a":1}{"a":1}', "[1] [2]", '{"a":1}\u0000', '\ufeff{"a":1}', '{"\\u0061":1,"a":2}', '{"a":1,"\\u0061":2}', '{"__proto__":{"a":1},"a":2}', '{"a":1,"__proto__":null}', '{"0":1,"a":2,"1":3}', '{"a":2,"00":1,"-0":3,"4294967295":4,"4294967294":5}', '{"":1,"a":2,"":3}', '{"a":{"a":{"a":{"a":1}}}}', '{"constructor":1,"toString":2,"valueOf":3,"hasOwnProperty":4}'];
for (let round = 0; round < 3; round++) for (const text of roots) check(text);
report("small texts, right and wrong");

let deep = "";
for (let i = 0; i < 3000; i++) deep += '{"next":';
check(deep + "null" + "}".repeat(3000));
check(deep + "null" + "}".repeat(2999));
check("[".repeat(3000) + "]".repeat(3000));
check("[".repeat(200000) + "]".repeat(200000));
report("deep texts");

const wide = ['{"name":"Zo\u00eb","city":"\u6771\u4eac","\u00e9":1,"\u6771":2}', '{"name":"\ud83d\ude00","lone":"\ud800","\ud800":3}', '{"name":"\\ud83d\\ude00","lone":"\\ud800","\\ud800":3}', '{"\u00ff":1,"name":"\u00ff"}', '{"name":"a\\nb\\tc\\"d\\\\e\\/f\\u0000g"}'];
for (let round = 0; round < 3; round++) for (const text of wide) check(text);
report("wide characters and escapes");

const parse = JSON.parse;
const otherWays: (() => unknown)[] = [
  () => JSON.parse('{"a":1,"b":2}', undefined),
  () => JSON.parse('{"a":1,"b":2}', null as any),
  () => JSON.parse('{"a":1,"b":2}', 5 as any),
  () => JSON.parse('{"a":1,"b":2}', (key, value) => (key === "a" ? undefined : value)),
  () => parse('{"a":1,"b":2}'),
  () => parse.call(null, '{"a":1,"b":2}'),
  () => Reflect.apply(parse, undefined, ['{"a":1,"b":2}']),
  () => ['{"a":1,"b":2}', "[1]"].map(text => JSON.parse(text)),
  () => JSON.parse({ toString: () => '{"a":1,"b":2}' } as any),
  () => JSON.parse(["[1", "2]"] as any),
  () => JSON.parse(12 as any),
  () => JSON.parse(null as any),
  () => JSON.parse(undefined as any),
  () => (JSON.parse as () => unknown)(),
];
for (const way of otherWays) {
  try {
    console.log(describe(way()));
  } catch (error) {
    console.log((error as Error).name + ":", (error as Error).message);
  }
}

const first = JSON.parse('{"a":1,"b":{"c":2}}');
const second = JSON.parse('{"a":1,"b":{"c":2}}');
first.b.c = 3;
first.d = 4;
delete first.a;
Object.freeze(second.b);
console.log(describe(first), describe(second), first !== second, first.b !== second.b, describe(JSON.parse('{"a":1,"b":{"c":2}}')));

let list = "[";
for (let i = 0; i < 200000; i++) list += (i ? "," : "") + '{"id":' + i + ',"tags":["t' + (i % 11) + '"],"at":{"x":' + (i % 13) + ',"y":' + i / 4 + "}}";
const parsed = JSON.parse(list + "]");
let sum = 0;
for (const item of parsed) sum = (sum + item.id + item.tags[0].length + item.at.x * 3 + item.at.y) % 1000003;
console.log(parsed.length, sum);
