// JSON.parse<T>(text) gives what JSON.parse(text) followed by a validation gives, however the text is spelled.
// IR+ ^ .*JSONStartsWith
// IR+ ^ .*JSONParseNumber
// VALIDATED compiles
import type { Schema } from "bun";

interface Product { id: number; name: string; price: number; tag: string; active: boolean }
interface Address { city: string; zip: string }
interface Person { name: string; age?: number; address: Address; tags: string[]; kind: "a" | "b"; note: string | null; pair: [number, string] }
interface Tagged { count: number & Schema.Int & Schema.Min<1> & Schema.Max<10>; code: string & Schema.MinLength<2> & Schema.Pattern<"^[a-z]+$">; list: number[] & Schema.MaxItems<3>; size?: number & Schema.Default<7> }
interface Whole { any: number & Schema.Int; least: number & Schema.Int & Schema.Min<0>; some?: number & Schema.Int }
type Shape = { kind: "circle"; radius: number } | { kind: "square"; side: number } | { kind: "none" };
interface Drawing { shapes: Shape[]; first?: Shape }
interface Open { id: number; [key: string]: unknown }
interface Counts { id: number; [key: string]: number }
type Closed = { id: number; inner: { a: boolean } } & Schema.Strict;
interface Tree { value: number; children: Tree[]; next?: Tree | null }
interface Loose { anything: unknown; maybe: number | undefined; object: object }
interface Named { constructor: string; toString?: string }

function show(value: unknown): string {
  if (value === undefined) return "undefined";
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value !== "object" || value === null) return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(show).join(",") + "]";
  return "{" + Object.keys(value).map(key => JSON.stringify(key) + ":" + show((value as Record<string, unknown>)[key])).join(",") + "}";
}
function attempt(what: string, parse: (text: string) => unknown, texts: string[]): void {
  for (const text of texts) {
    try {
      console.log(what, show(parse(text)));
    } catch (error) {
      console.log(what, (error as Error).constructor.name, JSON.stringify((error as Error).message));
    }
  }
}

attempt("product", text => JSON.parse<Product>(text), [
  '{"id":12345,"name":"Widget","price":19.99,"tag":"tools","active":true}',
  '{"id":-0,"name":"","price":1e3,"tag":"a\\nb\\u00e9\\ud83d\\"\\\\\\/","active":false}',
  ' { "id" : 1 , "name" : "x" , "price" : 2.5 , "tag" : "t" , "active" : true } ',
  '{"id": 1, "name": "x", "price": 2.5, "tag": "t", "active": true}',
  '{\n\t"id": 1,\r\n\t"name": "x",\n\t"price": 2.5,\n\t"tag": "t",\n\t"active": true\n}\n',
  '{"active":true,"tag":"tools","price":19.99,"name":"Widget","id":12345}',
  '{"id":1,"id":2,"name":"x","price":2.5,"tag":"t","active":true}',
  '{"id":"one","id":2,"name":"x","price":2.5,"tag":"t","active":true}',
  '{"id":2,"name":"x","price":2.5,"tag":"t","active":true,"id":"one"}',
  '{"id":1,"extra":{"a":[1,2,{"b":null}]},"name":"x","price":2.5,"tag":"t","active":true,"__proto__":{"x":1}}',
  '{"id":1,"name":"x","price":2.5,"tag":"t"}',
  '{"id":"1","name":"x","price":2.5,"tag":"t","active":true}',
  '{"id":1,"name":"x","price":2.5,"tag":"t","active":true,}',
  '{"id":1,"name":"x","price":2.5,"tag":"t","active":true} x',
  '{"id":01,"name":"x","price":2.5,"tag":"t","active":true}',
  '{"id":1.,"name":"x","price":2.5,"tag":"t","active":true}',
  '{"id":.5,"name":"x","price":2.5,"tag":"t","active":true}',
  '{"id":+1,"name":"x","price":2.5,"tag":"t","active":true}',
  '{"id":1e,"name":"x","price":2.5,"tag":"t","active":true}',
  '{"id":-,"name":"x","price":2.5,"tag":"t","active":true}',
  '{"id":1e999,"name":"x","price":2.5,"tag":"t","active":true}',
  '{"id":-1e-999,"name":"x","price":5e-324,"tag":"t","active":true}',
  '{"id":123456789012345678901234567890,"name":"x","price":0.1234567890123456789,"tag":"t","active":true}',
  '{"id":9007199254740993,"name":"x","price":999999999999999.9,"tag":"t","active":true}',
  '{"id":1E+2,"name":"x","price":1.5e-2,"tag":"t","active":true}',
  '{"\\u0069d":1,"name":"x","price":2.5,"tag":"t","active":true}',
  '{"id":1,"name":"x\u0001","price":2.5,"tag":"t","active":true}',
  '{"id":1,"name":"x\\x","price":2.5,"tag":"t","active":true}',
  '{"id":1,"name":"x\\u12","price":2.5,"tag":"t","active":true}',
  '{"id":1,"name":"éÿ","price":2.5,"tag":"Ā😀","active":true}',
  '{"id":1,"name":"x","price":2.5,"tag":"\ud83d","active":true}',
  '﻿{"id":1,"name":"x","price":2.5,"tag":"t","active":true}',
  '{"id":1,"name":"x","price":2.5,"tag":"t","active":true}\u0000',
  '{"id":1,"name":"x","price":2.5,"tag":"t","active":tru}',
  '{"id":1,"name":"x","price":2.5,"tag":"t","active":truer}',
  '{"id":1,"name":"x","price":2.5,"tag":"t","active":null}',
  "", " ", "{", "{}", "[]", "null", "1", '"text"', "{]", '{"id"}', '{"id":}', '{"id":1', '{"id":1,', '{,}',
]);
attempt("person", text => JSON.parse<Person>(text), [
  '{"name":"n","age":3,"address":{"city":"c","zip":"z"},"tags":["x","y"],"kind":"a","note":null,"pair":[1,"one"]}',
  '{"name":"n","address":{"city":"c","zip":"z"},"tags":[],"kind":"b","note":"said","pair":[1,"one"]}',
  '{"name":"n","age":null,"address":{"city":"c","zip":"z"},"tags":[],"kind":"b","note":"said","pair":[1,"one"]}',
  '{"name":"n","age":{"deep":[1,{"er":"\\n"}]},"address":{"city":"c","zip":"z"},"tags":[],"kind":"b","note":"said","pair":[1,"one"]}',
  '{"name":"n","age":"old","age":4,"address":{"zip":"z","city":"c","more":1},"tags":[ "x" , "y" ],"kind":"\\u0061","note":"said","pair":[ 1 , "one" ]}',
  '{"name":"n","age":4,"age":"old","address":{"city":1,"city":"c","zip":"z"},"tags":[],"kind":"b","note":"said","pair":[1,"one"]}',
  '{"name":"n","address":{"city":"c"},"tags":[],"kind":"b","note":"said","pair":[1,"one"]}',
  '{"name":"n","address":{"city":"c","zip":"z"},"tags":[1],"kind":"b","note":"said","pair":[1,"one"]}',
  '{"name":"n","address":{"city":"c","zip":"z"},"tags":[],"kind":"c","note":"said","pair":[1,"one"]}',
  '{"name":"n","address":{"city":"c","zip":"z"},"tags":[],"kind":"b","note":1,"pair":[1,"one"]}',
  '{"name":"n","address":{"city":"c","zip":"z"},"tags":[],"kind":"b","note":"said","pair":[1,"one",2]}',
  '{"name":"n","address":{"city":"c","zip":"z"},"tags":[],"kind":"b","note":"said","pair":[1]}',
  '{"name":"n","address":{"city":"c","zip":"z"},"tags":["x",],"kind":"b","note":"said","pair":[1,"one"]}',
  '{"name":"n","address":[],"tags":{},"kind":"b","note":"said","pair":[1,"one"]}',
]);
attempt("tagged", text => JSON.parse<Tagged>(text), [
  '{"count":1,"code":"ab","list":[]}', '{"count":10.0,"code":"abc","list":[1,2,3],"size":1}', '{"count":1e1,"code":"ab","list":[1]}',
  '{"count":0,"code":"ab","list":[]}', '{"count":11,"code":"ab","list":[]}', '{"count":1.5,"code":"ab","list":[]}', '{"count":1,"code":"a","list":[]}',
  '{"count":1,"code":"aB","list":[]}', '{"count":1,"code":"ab","list":[1,2,3,4]}', '{"count":1,"code":"ab","list":[],"size":"big"}',
]);
attempt("whole", text => JSON.parse<Whole>(text), [
  '{"any":0,"least":0}', '{"any":-0,"least":-0}', '{"any":-5,"least":5}', '{"any":1.0,"least":1e2}', '{"any":100e-2,"least":2.50e1}', '{"any":1.5,"least":1}', '{"any":1,"least":1e-2}',
  '{"any":9007199254740991,"least":9007199254740992}', '{"any":-9007199254740992,"least":9007199254740993}', '{"any":9007199254740994,"least":1}', '{"any":1e300,"least":12345678901234567890}',
  '{"any":123456789012345,"least":1234567890123456}', '{"any":-1e999,"least":1}', '{"any":00,"least":1}', '{"any":1,"least":-1}', '{"any":"1","least":1}', '{"any":1,"least":1,"some":2.5}', '{"any":1,"least":1,"some":-3}',
  '{ "least" : 7 , "any" : -7 , "some" : 0 }', '{"any":1,"any":2.5,"least":1}', '{"any":2.5,"any":2,"least":1}',
]);
attempt("drawing", text => JSON.parse<Drawing>(text), [
  '{"shapes":[{"kind":"circle","radius":1},{"kind":"square","side":2},{"kind":"none"}]}',
  '{"shapes":[{"radius":1,"kind":"circle"},{ "kind" : "square" , "side" : 2 }],"first":{"kind":"none","more":1}}',
  '{"shapes":[{"kind":"circle","radius":1,"kind":"none"}]}', '{"shapes":[{"kind":"none","kind":"circle","radius":1}]}',
  '{"shapes":[{"kind":"circle","side":2}]}', '{"shapes":[{"kind":"\\u0063ircle","radius":1}]}', '{"shapes":[],"first":{"kind":"circle"}}',
  '{"shapes":[],"first":{"kind":"circle","radius":"r","radius":3}}', '{"shapes":[{"kind":"line"}]}', '{"shapes":[null]}',
]);
attempt("open", text => JSON.parse<Open>(text), [
  '{"id":1}', '{"b":1,"id":1,"a":[{"x":null}],"0":"zero","__proto__":{"p":1},"toString":1}', '{"a":1,"id":2,"a":2}', '{"\\u0069d":3,"z":1}', '{"z":1}',
]);
attempt("counts", text => JSON.parse<Counts>(text), ['{"id":1,"a":2,"b":3}', '{"id":1,"a":"two"}', '{"id":1,"a":"two","a":2}', '{"a":1,"10":2,"2":3,"id":4}']);
attempt("record", text => JSON.parse<Record<string, number[]>>(text), ["{}", '{"a":[1],"b":[]}', '{"a":[1],"a":[2]}', '{"a":["x"],"a":[2]}', '{"a":1}', '{"__proto__":[1],"1":[2],"0":[3]}', "[]"]);
attempt("closed", text => JSON.parse<Closed>(text), ['{"id":1,"inner":{"a":true}}', '{"id":1,"inner":{"a":true},"more":1}', '{"id":1,"inner":{"a":true,"more":1}}', '{"inner":{"a":false},"id":1}']);
attempt("loose", text => JSON.parse<Loose>(text), [
  '{"anything":{"a":[1,"\\u00e9"]},"maybe":1,"object":[]}', '{"object":{}}', '{"anything":null,"object":{"__proto__":1}}', '{"anything":1,"maybe":"x","object":{}}', '{"anything":1,"object":1}',
]);
attempt("named", text => JSON.parse<Named>(text), ['{"constructor":"c","toString":"s"}', '{"constructor":"c"}', "{}"]);
attempt("roots", text => JSON.parse<number[]>(text), ["[]", "[1,2.5,-3e2]", " [ 1 , 2 ] ", "[1,]", "[,1]", "[1 2]", '["1"]', "[[1]]", "1"]);
attempt("roots", text => JSON.parse<string>(text), ['"text"', ' "\\u0041" ', "1", '"open', '""x']);
attempt("roots", text => JSON.parse<number | null>(text), ["1", "null", "-0", "nul", "true", "1 2"]);
attempt("roots", text => JSON.parse<boolean>(text), ["true", "false", " true ", "truefalse", "0"]);

const nested = (depth: number): string => '{"value":1,"children":['.repeat(depth) + "]}".repeat(depth);
const chained = (depth: number): string => '{"value":1,"children":[],"next":'.repeat(depth) + "null" + "}".repeat(depth);
const depthOf = (tree: Tree | null | undefined): number => { let depth = 0; for (; tree; tree = tree.children[0] ?? tree.next) depth++; return depth; };
for (const depth of [1, 2, 50, 400]) console.log("tree", depth, depthOf(JSON.parse<Tree>(nested(depth))), depthOf(JSON.parse<Tree>(chained(depth))));
attempt("tree", text => depthOf(JSON.parse<Tree>(text)), [chained(30).replace("null", '"end"'), nested(30).replace("[]", "[1]"), nested(30).slice(0, -1)]);

const whole = '{"name":"n\\u00e9","age":31,"address":{"city":"c\\n","zip":"z"},"tags":["x","yy"],"kind":"a","note":null,"pair":[1.5e1,"one"]}';
let syntaxErrors = 0, others = 0;
for (const text of [whole, (whole + "Ā").slice(0, -1)]) {
  for (let length = 0; length < text.length; length++) {
    try {
      JSON.parse<Person>(text.slice(0, length));
      others++;
    } catch (error) {
      if (error instanceof SyntaxError) syntaxErrors++;
      else others++;
    }
  }
}
console.log("text that ends early", syntaxErrors, others);
console.log("a rope", show(JSON.parse<Person>(whole.slice(0, 40) + whole.slice(40))), "16 bits", show(JSON.parse<Person>((whole + "Ā").slice(0, -1))));
console.log("no text", (() => { try { return show(JSON.parse<number>(JSON.parse("[5]")[0])); } catch (error) { return (error as Error).constructor.name; } })());
const long = JSON.stringify({ id: 1, name: "n".repeat(100000), price: 2, tag: "é".repeat(70000), active: true });
console.log("long", JSON.parse<Product>(long).name.length, JSON.parse<Product>(long).tag.length, JSON.parse<Product>('{"id":1,"name":"x","price":2.5,"tag":"t","active":true}').name);
