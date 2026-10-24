// A test of an array that is placed in front of a loop holds across a compiled serializer, a compiled parser and a chain of array methods, in the loop itself and in a function that the loop calls; where code of the program really changes the array in between, the loop sees the change.
// STATISTIC: SerializersCreated >= 2
// STATISTIC: ParsersCreated >= 1
class Link { x: number; next: Link | null; constructor(depth: number) { this.x = depth; this.next = depth ? new Link(depth - 1) : null } }
class Tree { value: number; name: string; children: Tree[]; constructor(depth: number) { this.value = depth; this.name = "n" + depth; this.children = depth ? [new Tree(depth - 1), new Tree(depth - 1)] : [] } }
interface Point { x: number; y: number; label?: string }
interface Segment { id: number; from: Point; to: Point; tags: string[] }

function lengthsOfLinks(list: Link[]): number { let n = 0; for (let i = 0; i < list.length; i++) n += JSON.stringify(list[i]).length + list[i].x; return n }
function lengthsOfTrees(list: Tree[]): number { let n = 0; for (let i = 0; i < list.length; i++) { const text = JSON.stringify(list[i]); n += text.length + list[i].value + list.length } return n }
function sameObjectAfterwards(link: Link): number { const before = link.x; const text = JSON.stringify(link); return before + text.length + link.x + (link.next ? link.next.x : 0) }

function parsedInTheLoop(texts: string[]): number { let n = 0; for (let round = 0; round < 3; round++) for (let i = 0; i < texts.length; i++) n += JSON.parse<Segment>(texts[i]).to.x + texts[i].length; return n }
function parsedByCallback(texts: string[], parse: (text: string) => Segment): number { let n = 0; for (let round = 0; round < 3; round++) for (const text of texts) n += parse(text).tags.length + parse(text).id; return n }
const segment = (text: string) => JSON.parse<Segment>(text);
const segmentWithoutType = (text: string) => JSON.parse(text) as Segment;

function chainInTheLoop(list: number[], text: string): number { let n = 0; for (let i = 0; i < list.length; i++) n += list[i] + text.split("").slice(0, -1).join("").length; return n }
const ways: Array<(s: string) => string> = [s => s, s => "#" + s, s => s + "#", s => s.slice(1), s => s.slice(0, -1), s => s + s, s => s.split("").slice(0, -1).join(""), s => s.split("").slice(1).join("-")];
function chainInTheCallee(list: number[], make: (s: string) => string, text: string): number { let n = 0; for (let i = 0; i < list.length; i++) n += list[i] + make(text).length; return n }

let shared: Array<number | string> = [];
class Shrinks { k: number; constructor(k: number) { this.k = k } toJSON() { shared.length = 1; shared[0] = 1.5; return this.k } }
function serializerChangesTheArray(list: Array<number | string>, value: Shrinks): string { let text = ""; for (let i = 0; i < list.length; i++) { text += list[i] + ","; text += JSON.stringify(value).length + ";" } return text }
function withGetter(k: number) { return { k, get g() { shared.length = 2; shared[1] = "s"; return k } } }
function getterChangesTheArray(list: Array<number | string>, value: { k: number; g: number }): string { let text = ""; for (let i = 0; i < list.length; i++) { text += list[i] + ","; text += JSON.stringify(value).length + ";" } return text }
function callbackChangesTheArray(list: Array<number | string>, other: number[]): string { let text = ""; for (let i = 0; i < list.length; i++) text += list[i] + "," + other.map(x => { list.length = 2; list[1] = "s"; return x + 1 }).filter(x => x > 2).length + ";"; return text }
function reviverChangesTheArray(list: Array<number | string>, source: string): string { let text = ""; for (let i = 0; i < list.length; i++) { text += list[i] + ","; text += JSON.parse(source, (key, member) => { list.length = 1; return member }).a + ";" } return text }

const texts = ['{"id":1,"from":{"x":1,"y":2},"to":{"x":3,"y":4},"tags":[]}', '{"tags":["a","b"],"to":{"y":4,"x":5,"label":"l"},"from":{"x":1,"y":2},"id":2}', '{"id":3,"from":{"x":1,"y":2},"to":{"x":7,"y":4},"tags":["c"],"more":[1,2,{"deep":[3]}]}'];
for (let round = 0; round < 3; round++) {
  console.log("links", lengthsOfLinks([new Link(0), new Link(1), new Link(round + 2)]));
  console.log("trees", lengthsOfTrees([new Tree(0), new Tree(1), new Tree(round)]));
  console.log("same object", sameObjectAfterwards(new Link(round)));
  console.log("parsed in the loop", parsedInTheLoop(texts));
  console.log("parsed by a callback", parsedByCallback(texts, segment), parsedByCallback(texts, segmentWithoutType));
  console.log("chain in the loop", chainInTheLoop([1, 2, 3], "abcdef".slice(round)));
  let all = 0; for (const make of ways) all += chainInTheCallee([1, 2, 3], make, "abcdef".slice(round)); console.log("chain in the callee", all);
  shared = [1, 2, 3]; console.log("toJSON", serializerChangesTheArray(shared, new Shrinks(round)), shared.length, shared[0]);
  shared = [1, 2, 3]; console.log("getter", getterChangesTheArray(shared, withGetter(round)), shared.length, shared[1]);
  shared = [1, 2, 3]; console.log("callback", callbackChangesTheArray(shared, [1, 2, 3, 4]), shared.length, shared[1]);
  shared = [1, 2, 3]; console.log("reviver", reviverChangesTheArray(shared, '{"a":' + round + '}'), shared.length);
}
