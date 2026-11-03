// A valid text is cut at every byte, from both ends, and every byte is left out, doubled, replaced and preceded by 25 others: `JSON.parse(text) as T` says what JSON.parse says.
const plainParse: (text: string) => any = globalThis.JSON.parse;

function show(value: any): string {
  if (Array.isArray(value)) return "[" + value.map(show).join(",") + "]";
  if (typeof value === "string") return JSON.stringify(value) + value.length;
  if (typeof value !== "object" || value === null) return Object.is(value, -0) ? "-0" : typeof value + ":" + String(value);
  return "{" + Object.getOwnPropertyNames(value).map(key => JSON.stringify(key) + ":" + show(value[key])).join(",") + "}" + (Object.getPrototypeOf(value) === Object.prototype ? "" : "!");
}

function outcome(parse: (text: string) => unknown, text: string): string {
  try {
    return show(parse(text));
  } catch (error: any) {
    return error.name + ": " + error.message;
  }
}

let shown = 0;
function differs(parse: (text: string) => unknown, text: string): number {
  const typed = outcome(parse, text);
  const plain = outcome(plainParse, text);
  if (typed === plain) return 0;
  if (shown++ < 12) console.log("DIFFERENT on " + JSON.stringify(text).slice(0, 300) + "\n  typed: " + typed.slice(0, 300) + "\n  plain: " + plain.slice(0, 300));
  return 1;
}

type Everything = {
  text: string;
  count: number;
  flag: boolean;
  nothing: null;
  list: number[];
  pair: [string, number];
  byName: Record<string, number>;
  inner: { a: string; b?: number };
  either: { kind: "a"; a: number } | { kind: "b"; b: string };
  loose: unknown;
  maybe?: string;
  words: string[];
};
type Tree = { name: string; kids: Tree[] };

const everything = (text: string) => JSON.parse(text) as Everything;
const list = (text: string) => JSON.parse(text) as Everything[];
const tree = (text: string) => JSON.parse(text) as Tree;
const dictionary = (text: string) => JSON.parse(text) as Record<string, Everything>;

const compact =
  '{"text":"a\\n\\"b\\\\\\u00e9\\ud83d\\ude00 é","count":-12.5e+2,"flag":true,"nothing":null,"list":[0,-0,1e3,2.50],"pair":["p",7],"byName":{"one":1,"t\\u0077o":2,"":3},' +
  '"inner":{"a":"x","b":2},"either":{"kind":"b","b":"y"},"loose":{"z":[1,"two",{"three":null}],"f":false},"maybe":"m","words":["","w","a word that is longer than any cache of short strings would take"],"other":[{"u":1}]}';
const otherOrder =
  ' {\n\t"other" : 1 , "words" : [ ] , "either" : { "a" : 1 , "kind" : "a" } , "inner" : { "a" : "x" } ,\r\n "byName" : { } , "pair" : [ "p" , 7 ] , "list" : [ ] , "nothing" : null , "flag" : false , "count" : 0 , "loose" : 1 , "text" : "" } ';
const treeText = '{"name":"r","kids":[{"name":"a","kids":[]},{"kids":[{"name":"c","kids":[],"x":1}],"name":"b"}]}';

const replacements = ["\u0000", '"', "\\", "}", "]", "{", "[", ",", ":", " ", "0", "-", "e", ".", "ÿ", "Ā", " ", "\ud800", "\udc00", "\u001f", "\u007f", "n", "t", "u", "/"];

function sweep(label: string, parse: (text: string) => unknown, text: string): void {
  let different = 0;
  let texts = 0;
  for (let at = 0; at <= text.length; at++) {
    different += differs(parse, text.slice(0, at));
    different += differs(parse, text.slice(at));
    different += differs(parse, text.slice(0, at) + text.slice(at + 1));
    different += differs(parse, text.slice(0, at) + text.slice(at, at + 1) + text.slice(at));
    texts += 4;
    for (const replacement of replacements) {
      different += differs(parse, text.slice(0, at) + replacement + text.slice(at + 1));
      different += differs(parse, text.slice(0, at) + replacement + text.slice(at));
      texts += 2;
    }
  }
  console.log(label + ": " + texts + " texts: " + different + " differ");
}

const wide = (text: string) => (text + "Ā").slice(0, -1);

sweep("a record", everything, compact);
sweep("a record, 16-bit text", everything, wide(compact));
sweep("another order, spaced", everything, otherOrder);
sweep("a list", list, "[" + compact + "," + otherOrder + "]");
sweep("a tree", tree, treeText);
sweep("a tree, 16-bit text", tree, wide(treeText));
sweep("a dictionary", dictionary, '{"first":' + compact + ',"se\\u0063ond":' + otherOrder + "}");
