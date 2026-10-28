// `JSON.parse(text)` into three types, one inside the other, and into a list of the innermost: a text of the list names the members of the innermost type and then those of the outermost.
interface Leaf {
  aa: string;
  q: string;
}
interface Mid {
  aw: number;
  leaf: Leaf;
}
interface Root {
  a: number;
  b: number;
  mid: Mid;
}
function root(text: string): Root {
  return JSON.parse(text);
}
function leaves(text: string): Leaf[] {
  return JSON.parse(text);
}
function showRoot(label: string, text: string) {
  const value = root(text);
  console.log(label + ":", JSON.stringify(value), value.a + value.b, value.mid.aw, value.mid.leaf.aa.length, value.mid.leaf.q.length);
}
function showLeaves(label: string, text: string) {
  for (const leaf of leaves(text)) console.log(label + ":", JSON.stringify(leaf), Object.keys(leaf).join(), typeof leaf.aa, leaf.aa.length, leaf.aa, typeof leaf.q, leaf.q.length, leaf.q);
}
for (let turn = 0; turn < 3; turn++) showRoot("one member more in each", '{"t":0,"a":1,"b":2,"mid":{"t":0,"aw":1,"leaf":{"t":0,"aa":"x","q":"y"}}}');
const letters = "abcdefghijklmnopqrstuvwxyz";
for (const first of letters) {
  for (const second of letters) {
    const name = first + second;
    if (name === "aa" || name === "aw" || name === "ab") continue;
    Bun.gc(true);
    for (let turn = 0; turn < 3; turn++) showRoot("the innermost begins otherwise", '{"a":1,"b":2,"mid":{"aw":1,"leaf":{"ab":0,"aa":"x","q":"y"}}}');
    for (let turn = 0; turn < 2; turn++) showRoot("one member more in the outermost", `{"${name}":0,"a":1,"b":2,"mid":{"aw":1,"leaf":{"aa":"x","q":"y"}}}`);
    showLeaves("a list", `[{"aa":"x","q":"y","${name}":0,"a":1234567,"b":7654321,"mid":{"aw":1,"leaf":{"ab":0,"aa":"x","q":"y"}}}]`);
  }
}
