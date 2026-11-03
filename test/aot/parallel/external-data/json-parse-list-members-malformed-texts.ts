interface Inner { id: number; label: string }
interface Holder { name: string; items: Inner[]; values: number[]; next: Holder | null }
interface Tree { name: string; size: number; children: Tree[] }

const parseHolder = (text: string) => JSON.parse(text) as Holder;
const parseTree = (text: string) => JSON.parse(text) as Tree;

function walk(value: unknown): string {
  if (Array.isArray(value)) return "[" + Object.getOwnPropertyNames(value).join() + "|" + value.map(walk).join() + "]";
  if (value && typeof value === "object") return "{" + Reflect.ownKeys(value).map(key => String(key) + ":" + walk((value as Record<string, unknown>)[key as string])).join() + "}" + (Object.getPrototypeOf(value) === Object.prototype ? "" : "!");
  return Object.is(value, -0) ? "-0" : typeof value + " " + String(value);
}
function answer(parse: (text: string) => unknown, text: string): string {
  try {
    return walk(parse(text));
  } catch (error) {
    return (error as Error).name + ": " + (error as Error).message;
  }
}
let hash = 0;
const note = (line: string) => { for (let i = 0; i < line.length; i++) hash = (hash * 31 + line.charCodeAt(i)) | 0; };

const good = `{"name":"n","a":1,"items":[{"id":1,"k":true,"label":"x"},{"id":2,"k":false,"label":"y"}],"b":[1],"values":[1,2.5,3],"c":{"d":null},"next":{"name":"m","a":2,"items":[],"b":[],"values":[],"c":{},"next":null,"e":0},"e":0}`;
const goodTree = `{"name":"r","kind":"d","size":1,"children":[{"name":"s","kind":"d","size":2,"children":[{"name":"t","kind":"f","size":3,"children":[],"o":1}],"o":1},{"name":"u","kind":"f","size":4,"children":[],"o":1}],"o":1}`;
const warm = () => { for (let i = 0; i < 6; i++) { parseHolder(good); parseTree(goodTree); } };
warm();
console.log(answer(parseHolder, good));
console.log(answer(parseTree, goodTree));

for (const [parse, text] of [[parseHolder, good], [parseTree, goodTree]] as const) {
  let failures = 0;
  for (let cut = 0; cut <= text.length; cut++) {
    const line = answer(parse, text.slice(0, cut));
    note(line);
    if (cut % 23 === 0) console.log("cut", cut, line);
    if (line.startsWith("SyntaxError")) failures++;
    note(answer(parse, text));
  }
  console.log("cut: failures", failures, "of", text.length + 1, hash);
  for (const other of ["}", "]", ",", ":", "\"", "{", "[", "x", " ", "0", "\\", "é", "☃", "\n"]) {
    let changed = 0;
    for (let at = 0; at < text.length; at++) {
      const line = answer(parse, text.slice(0, at) + other + text.slice(at + 1));
      note(line);
      if (line.startsWith("SyntaxError")) changed++;
      const inserted = answer(parse, text.slice(0, at) + other + text.slice(at));
      note(inserted);
      if (at % 61 === 0) console.log("change", JSON.stringify(other), at, line, "|", inserted);
    }
    note(answer(parse, text));
    console.log("changed to", JSON.stringify(other), changed, hash);
  }
}

const odd = [
  `{"name":"n","a":1,"items":[{"id":1,"k":true,"label":"x"},{"id":2,"k":false,"label":"y"}],"b":[1],"values":[1,2.5,3],"values":[9],"c":{"d":null},"next":null,"e":0}`,
  `{"name":"n","a":1,"a":2,"items":[],"b":[1],"values":[],"c":{},"next":null,"e":0}`,
  `{"name":"n","a":1,"items":[{"id":1,"k":true,"label":"x","id":7}],"b":[1],"values":[],"c":{},"next":null,"e":0}`,
  `{"name":"n","a":1,"items":[{"id":1,"k":true,"k":false,"label":"x"}],"b":[1],"values":[],"c":{},"next":null,"e":0}`,
  `{"name":"n","__proto__":{"evil":1},"items":[],"b":[1],"values":[],"c":{},"next":null,"e":0}`,
  `{"name":"n","a":1,"items":[{"id":1,"__proto__":[],"label":"x"}],"b":[1],"values":[],"c":{},"next":null,"e":0}`,
  `{"name":"n","a":1,"items":[{"__proto__":null,"id":1,"label":"x"}],"b":[1],"values":[],"c":{"__proto__":5},"next":null,"e":0}`,
  `{"e":0,"next":null,"c":{},"values":[3,2,1],"b":[1],"items":[{"label":"x","k":true,"id":1}],"a":1,"name":"n"}`,
  `{"name":"n","a":1,"values":[1],"b":[1],"items":[{"id":1,"k":true,"label":"x"}],"c":{},"next":null,"e":0}`,
  `{"name":"n","a":1,"items":{"id":1,"k":true,"label":"x"},"b":[1],"values":[1],"c":{},"next":null,"e":0}`,
  `{"name":"n","a":1,"items":[[{"id":1,"k":true,"label":"x"}]],"b":[1],"values":[[1]],"c":{},"next":null,"e":0}`,
  `{"name":"n","a":1,"items":[],"b":[1],"values":{"0":1},"c":{},"next":[],"e":0}`,
  `{"name":"n","a":1,"items":[],"b":[1],"values":[],"c":{},"next":[{"name":"m","a":2,"items":[],"b":[],"values":[],"c":{},"next":null,"e":0}],"e":0}`,
  `{"name":"n","a":1,"items":[1,"two",null,true],"b":[1],"values":["1",null,{},[]],"c":{},"next":null,"e":0}`,
  `{"name":"n","a":1,"items":null,"b":[1],"values":null,"c":{},"next":null,"e":0}`,
  `{"name":"n","a":1,"items":"[]","b":[1],"values":0,"c":{},"next":null,"e":0}`,
  `{"name":"n","a":1,"items":[{}],"b":[1],"values":[],"c":{},"next":{},"e":0}`,
  `{"name":"n","a":1,"items":[{"id":"1","k":true,"label":2}],"b":[1],"values":[],"c":{},"next":null,"e":0}`,
  `{"name":"n","0":1,"items":[],"1":[1],"values":[],"c":{},"next":null,"e":0}`,
  `{"name":"n","a":1,"items":[{"id":1,"0":true,"label":"x"}],"b":[1],"values":[],"c":{},"next":null,"e":0}`,
  `{"name":"n","a":1,"items":[],"b":[1],"values":[],"c":{},"next":null,"e":0,"f":1}`,
  `{"name":"n","a":1,"items":[],"b":[1],"values":[],"c":{},"next":null}`,
  `{"name":"n","a":1,"items":[],}`,
  `{"name":"n","a":1,"items":[,]}`,
  `{"name":"n","a":1,"items":[1,]}`,
  `{"name":"n","a":1,"items":[{"id":1,"k":true,"label":"x"},]}`,
  `{"name":"n","a":1,"items":[{"id":1,"k":true,"label":"x"}{"id":1,"k":true,"label":"x"}]}`,
  `{"n\\u0061me":"n","a":1,"items":[],"b":[1],"v\\u0061lues":[4],"c":{},"next":null,"e":0}`,
  ` { "name" : "n" , "a" : 1 , "items" : [ { "id" : 1 , "k" : true , "label" : "x" } ] , "b" : [ 1 ] , "values" : [ 1 , 2 ] , "c" : { } , "next" : null , "e" : 0 } `,
  `\t{\n"name":"n",\r\n"a":1,"items":[\n],"b":[1],"values":[\t],"c":{},"next":null,"e":0}\n`,
];
for (let round = 0; round < 5; round++) {
  for (const [index, text] of odd.entries()) {
    const line = answer(parseHolder, text);
    if (round === 0 || round === 4) console.log("odd", round, index, line);
    note(line);
    if (round & 1) note(answer(parseHolder, good));
  }
}
console.log(hash, answer(parseHolder, good) === walk(JSON.parse(good + " ")));

console.log(JSON.stringify(JSON.parse(good, function (key, value) { return typeof value === "number" ? value + 1 : Array.isArray(value) ? value.concat(key) : value; }) as Holder));
console.log(JSON.stringify(JSON.parse(goodTree, (key, value) => (key === "children" && value.length === 0 ? undefined : value)) as Tree));
