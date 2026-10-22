// A part of parsed JSON is cast from its base type to a subtype whose other fields are primitives. Any object passes the cast, a number throws there. A missing field reads undefined, and a field of another kind throws at its first typed read.
interface Base { kind: number }
interface Leaf extends Base { text: string; size: number }
interface Info { version: string; root: Base }
function showLeaf(leaf: Leaf): string { return String(leaf.kind) + "|" + String(leaf.text) + "|" + String(leaf.size); }
function makeLeaf(text: string, size: number): Leaf { return { kind: 1, text, size }; }
function readInfo(text: string): Info { return JSON.parse(text) as Info; }
let sum = "";
for (let i = 0; i < 3; i++) sum += showLeaf(makeLeaf("t" + i, i)) + " ";
console.log(sum);
const texts: string[] = ['{"version":"1","root":{"kind":1,"text":"a","size":3}}', '{"version":"1","root":{"kind":1}}', '{"version":"1","root":{"kind":1,"text":5,"size":"big"}}', '{"version":"1","root":{"size":3,"more":true,"text":"a","kind":1}}', '{"version":"1","root":7}', '{"version":"1","root":[]}'];
for (const text of texts) {
  try { console.log("leaf " + showLeaf(readInfo(text).root as Leaf)); } catch (error) { console.log("leaf threw " + (error as Error).constructor.name); }
}
