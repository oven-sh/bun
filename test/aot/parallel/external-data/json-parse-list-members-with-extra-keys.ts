// Flags: --aot-log-type-mismatches
interface Item { id: number; label: string }
interface Cell { id: number; label: string }
interface Entry { id: number; label: string }
interface Part { id: number; label: string }
interface Piece { id: number; label: string }
interface Choice { id: number; label: string }
interface Row { id: number; label: string }
interface Numbers { name: string; values: number[] }
interface Texts { name: string; tags: string[] }
interface Flags { name: string; flags: boolean[] }
interface Gaps { name: string; values: (number | null)[] }
interface Records { name: string; records: Item[] }
interface Tree { name: string; size: number; children: Tree[] }
interface Grid { name: string; rows: number[][] }
interface Deep { name: string; cube: Cell[][][] }
interface MaybeList { name: string; entries: Entry[] | null }
interface OptionalList { name: string; parts?: Part[] }
interface Anything { name: string; things: unknown[] }
interface Mixed { name: string; pieces: (number | string | Piece)[] }
interface Either { name: string; item: Choice | Choice[] }
interface TwoLists { first: number[]; name: string; second: Row[]; third: string[] }

function walk(value: unknown): string {
  if (Array.isArray(value)) return "[" + Object.getOwnPropertyNames(value).join() + "|" + value.map(walk).join() + "]";
  if (value && typeof value === "object") return "{" + Reflect.ownKeys(value).map(key => String(key) + ":" + walk((value as Record<string, unknown>)[key as string])).join() + "}";
  return Object.is(value, -0) ? "-0" : typeof value + " " + String(value);
}

function show(label: string, parse: (text: string) => unknown, use: (value: any) => unknown, texts: string[]) {
  let last = "";
  for (let round = 0; round < 7; round++) {
    for (const [index, text] of texts.entries()) {
      let line: string;
      try {
        const value = parse(text);
        line = JSON.stringify(value) + " " + walk(value) + " " + String(use(value));
      } catch (error) {
        line = (error as Error).name + ": " + (error as Error).message;
      }
      const whole = label + " " + index + " " + line;
      if (round === 0 || round === 6) console.log(round, whole);
      else last = whole;
    }
  }
  return last;
}

const sum = (list: number[]) => { let total = 0; for (const value of list) total += value; return total; };
const count = (tree: Tree): number => { let total = tree.size; for (const child of tree.children) total += count(child); return total; };

show("numbers", text => JSON.parse(text) as Numbers, (v: Numbers) => sum(v.values) + v.values.length, [
  `{"name":"a","x":1,"values":[1,2,3],"y":2}`,
  `{"name":"a","x":1,"values":[],"y":2}`,
  `{"name":"a","x":1,"values":[1.5,-2.25,1e3,-0,0,12345678901234567890],"y":2}`,
  `{"name":"a","x":1,"values":[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20.5],"y":2}`,
  `{"name":"a","x":1,"values":[ 1 , 2 ,3 ] ,"y":2}`,
]);
show("texts", text => JSON.parse(text) as Texts, (v: Texts) => v.tags.join("+") + v.tags.length, [
  `{"name":"a","x":1,"tags":["p","q","a longer text that no cache keeps for long, or does it","\\u00e9\\n","é"],"y":2}`,
  `{"name":"a","x":1,"tags":[],"y":2}`,
  `{"name":"a","x":1,"tags":[""],"y":[1,{"z":[]}]}`,
]);
show("flags", text => JSON.parse(text) as Flags, (v: Flags) => v.flags.filter(flag => flag).length, [
  `{"name":"a","x":1,"flags":[true,false,true],"y":2}`,
  `{"name":"a","x":1,"flags":[],"y":2}`,
]);
show("gaps", text => JSON.parse(text) as Gaps, (v: Gaps) => v.values.map(value => value ?? -1).join(), [
  `{"name":"a","x":1,"values":[1,null,3],"y":2}`,
  `{"name":"a","x":1,"values":[null],"y":2}`,
  `{"name":"a","x":1,"values":[1,2],"y":2}`,
]);
show("records", text => JSON.parse(text) as Records, (v: Records) => v.records.map(item => item.id + item.label).join(), [
  `{"name":"a","x":1,"records":[{"id":1,"more":true,"label":"one"},{"id":2,"more":false,"label":"two"}],"y":2}`,
  `{"name":"a","x":1,"records":[],"y":2}`,
  `{"name":"a","x":1,"records":[{"id":1,"more":true,"label":"one"}],"y":2}`,
  `{"name":"a","x":1,"records":[{"id":1,"label":"one"},{"id":2,"more":false,"label":"two"}],"y":2}`,
  `{"name":"a","x":1,"records":[{"id":1,"more":true,"label":"one"},{"label":"two","id":2}],"y":2}`,
]);
const tree = (depth: number, n: number, more: string): string => {
  let children = "";
  if (depth) for (let i = 0; i < 3; i++) children += (i ? "," : "") + tree(depth - 1, n * 3 + i, more);
  return `{"name":"node ${n}","kind":"dir","size":${n},"mode":420,"children":[${children}]${more}}`;
};
show("tree", text => JSON.parse(text) as Tree, count, [tree(3, 1, `,"owner":"root"`), tree(2, 5, `,"owner":"root"`), tree(0, 7, `,"owner":"root"`), tree(2, 2, ""), tree(1, 1, `,"owner":"root","group":"wheel"`)]);
show("root with more", text => JSON.parse(text) as Tree, count, [
  `{"name":"r","kind":"dir","size":1,"children":[{"name":"c","kind":"file","size":2,"children":[]},{"name":"d","kind":"file","size":3,"children":[]}],"version":3}`,
  `{"name":"r","kind":"dir","size":1,"children":[{"name":"c","kind":"file","size":2,"children":[],"version":4},{"name":"d","kind":"file","size":3,"children":[]}]}`,
]);
show("grid", text => JSON.parse(text) as Grid, (v: Grid) => v.rows.map(sum).join(), [
  `{"name":"a","x":1,"rows":[[1,2],[3,4.5],[]],"y":2}`,
  `{"name":"a","x":1,"rows":[],"y":2}`,
  `{"name":"a","x":1,"rows":[[]],"y":2}`,
]);
show("deep", text => JSON.parse(text) as Deep, (v: Deep) => v.cube.flat(2).map(item => item.label).join(), [
  `{"name":"a","x":1,"cube":[[[{"id":1,"k":0,"label":"l"}],[]],[[{"id":2,"k":0,"label":"m"},{"id":3,"k":0,"label":"n"}]]],"y":2}`,
  `{"name":"a","x":1,"cube":[[[]]],"y":2}`,
  `{"name":"a","x":1,"cube":[],"y":2}`,
]);
show("list or null", text => JSON.parse(text) as MaybeList, (v: MaybeList) => (v.entries ? v.entries.map(item => item.label).join() : "none"), [
  `{"name":"a","x":1,"entries":null,"y":2}`,
  `{"name":"a","x":1,"entries":[{"id":1,"k":0,"label":"l"}],"y":2}`,
  `{"name":"a","x":1,"entries":[],"y":2}`,
]);
show("optional list", text => JSON.parse(text) as OptionalList, (v: OptionalList) => (v.parts ? v.parts.map(item => item.label).join() : "none"), [
  `{"name":"a","x":1,"y":2}`,
  `{"name":"a","x":1,"parts":[{"id":1,"k":0,"label":"l"}],"y":2}`,
]);
show("anything", text => JSON.parse(text) as Anything, (v: Anything) => v.things.length, [
  `{"name":"a","x":1,"things":[1,"two",null,{"id":1,"label":"l","__proto__":{"a":1}},[1,[2,{"b":[]}]],true],"y":2}`,
  `{"name":"a","x":1,"things":[1,2,3],"y":2}`,
  `{"name":"a","x":1,"things":[],"y":2}`,
]);
show("mixed", text => JSON.parse(text) as Mixed, (v: Mixed) => v.pieces.map(item => (typeof item === "object" ? item.label : item)).join(), [
  `{"name":"a","x":1,"pieces":[1,"two",{"id":1,"k":0,"label":"l"}],"y":2}`,
  `{"name":"a","x":1,"pieces":[{"id":1,"k":0,"label":"l"},2],"y":2}`,
]);
show("either", text => JSON.parse(text) as Either, (v: Either) => (Array.isArray(v.item) ? v.item.map(item => item.label).join() : v.item.label), [
  `{"name":"a","x":1,"item":{"id":1,"k":0,"label":"l"},"y":2}`,
  `{"name":"a","x":1,"item":[{"id":1,"k":0,"label":"l"},{"id":2,"k":0,"label":"m"}],"y":2}`,
]);
show("two lists", text => JSON.parse(text) as TwoLists, (v: TwoLists) => sum(v.first) + v.second.map(item => item.label).join() + v.third.join(), [
  `{"a":0,"first":[1,2],"b":0,"name":"n","c":0,"second":[{"id":1,"k":0,"label":"l"}],"d":0,"third":["x"],"e":0}`,
  `{"first":[1,2],"b":0,"name":"n","second":[{"id":1,"k":0,"label":"l"}],"third":["x"]}`,
  `{"a":0,"first":[],"b":0,"name":"n","c":0,"second":[],"d":0,"third":[],"e":0}`,
]);
