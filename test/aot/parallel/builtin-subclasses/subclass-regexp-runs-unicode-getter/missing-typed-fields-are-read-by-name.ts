// Optional fields with written types that most objects leave out, read by name: the readers are typed functions that are entered with an argument of another type than declared, so their generic versions run.
// A missing field is undefined only while nothing above the object has the name, and the word of an empty slot must not be taken for a value, nor a value, or a closure that is not made yet, for an empty slot.
const shelf: any = globalThis;
const shelfKey = process.env.SHELF || "shelf";
function hide(x: any): any { shelf[shelfKey] = x; return shelf[shelfKey]; }
let sink: any = 0;
const notANumber: any = hide("x");
const lines: string[] = [];

class Owner { id = 1; }
interface Style { gap: number; note?: string; weight?: number; owner?: Owner; flag?: boolean; count?: number }
function makeStyle(i: number): Style { return { gap: i }; }
interface Tool { run(): number; name?: string; size?: number; next?: Tool }
function makeTool(i: number): Tool { return { run() { return i; } }; }
class Item { kind: number; parent?: Item; text?: string; pos?: number; constructor(kind: number) { this.kind = kind; } }
class Leaf extends Item { extra?: string; width?: number; }

function noteOf(o: Style, scale: number) { sink = scale + 1; return o.note; }
function weightOf(o: Style, scale: number) { sink = scale + 1; return o.weight; }
function ownerOf(o: Style, scale: number) { sink = scale + 1; return o.owner; }
function flagOf(o: Style, scale: number) { sink = scale + 1; return o.flag; }
function countOf(o: Style, scale: number) { sink = scale + 1; return o.count; }
function runOf(o: Tool, scale: number) { sink = scale + 1; return o.run; }
function nameOf(o: Tool, scale: number) { sink = scale + 1; return o.name; }
function sizeOf(o: Tool, scale: number) { sink = scale + 1; return o.size; }
function nextOf(o: Tool, scale: number) { sink = scale + 1; return o.next; }
function parentOf(o: Item, scale: number) { sink = scale + 1; return o.parent; }
function textOf(o: Item, scale: number) { sink = scale + 1; return o.text; }
function posOf(o: Item, scale: number) { sink = scale + 1; return o.pos; }
function extraOf(o: Leaf, scale: number) { sink = scale + 1; return o.extra; }
function widthOf(o: Leaf, scale: number) { sink = scale + 1; return o.width; }

function show(v: any): string {
  if (typeof v === "function") return "function:" + v();
  if (typeof v === "object" && v !== null) return "object:" + Object.keys(v).join("+");
  return Object.is(v, -0) ? "-0" : String(v);
}
const styles: Style[] = [], tools: Tool[] = [], items: Item[] = [], leaves: Leaf[] = [];
for (let i = 0; i < 8; i++) { styles.push(makeStyle(i)); tools.push(makeTool(i)); items.push(new Item(i)); leaves.push(new Leaf(i)); }

function look(title: string) {
  // Often enough for whatever remembers an answer to remember it.
  let text = "";
  for (let turn = 0; turn < 40; turn++) {
    const parts: string[] = [];
    for (let i = 0; i < 8; i++) {
      const s = styles[i], t = tools[i], n = items[i], l = leaves[i];
      parts.push([noteOf(s, notANumber), weightOf(s, notANumber), ownerOf(s, notANumber), flagOf(s, notANumber), countOf(s, notANumber),
        runOf(t, notANumber), nameOf(t, notANumber), sizeOf(t, notANumber), nextOf(t, notANumber),
        parentOf(n, notANumber), textOf(n, notANumber), posOf(n, notANumber),
        parentOf(l, notANumber), textOf(l, notANumber), posOf(l, notANumber), extraOf(l, notANumber), widthOf(l, notANumber)].map(show).join(","));
    }
    const now = parts.join(" | ");
    if (turn && now !== text) lines.push(title + ": CHANGED AT TURN " + turn);
    text = now;
  }
  lines.push(title + ": " + text);
}

look("all left out");
styles[1].note = "n"; styles[1].weight = 1.5; styles[1].owner = new Owner(); styles[1].flag = false; styles[1].count = 3;
styles[2].weight = NaN; styles[3].weight = Infinity; styles[4].weight = -0; styles[5].weight = -Infinity; styles[6].count = -2147483647; styles[7].count = 2 ** 40;
(styles[2] as any).note = undefined; (styles[3] as any).note = null; (styles[2] as any).owner = null; (styles[3] as any).owner = undefined; (styles[6] as any).weight = undefined; (styles[7] as any).weight = null;
tools[1].name = "t"; tools[1].size = 2.5; tools[1].next = tools[2];
items[1].parent = items[2]; items[1].text = "x"; items[1].pos = 7.5; leaves[1].parent = items[3]; leaves[1].extra = "e"; leaves[1].width = 0.5; leaves[2].text = "lt";
look("some are there");
(Item.prototype as any).text = "item"; (Item.prototype as any).pos = 11; (Leaf.prototype as any).width = 22; (Leaf.prototype as any).parent = null;
look("the prototypes of the classes have some");
Object.defineProperty(Item.prototype, "parent", { get() { return "got:" + this.kind; }, configurable: true });
look("a getter above");
delete (Item.prototype as any).text; delete (Item.prototype as any).pos; delete (Leaf.prototype as any).width; delete (Leaf.prototype as any).parent; delete (Item.prototype as any).parent;
look("the prototypes are as they were");
Object.setPrototypeOf(Leaf.prototype, { extra: "other", pos: 5, text: "ot" });
Object.setPrototypeOf(styles[5], { note: "own chain", count: 9 });
look("other objects above");
delete styles[1].note; delete styles[1].weight; delete styles[1].owner; delete items[1].text; delete leaves[1].width;
Object.defineProperty(styles[4], "note", { get() { return "getter"; }, configurable: true, enumerable: true });
Object.defineProperty(items[4], "pos", { value: 4, writable: false, enumerable: false, configurable: true });
look("deleted and redefined");
console.log(lines.join("\n"), sink);
