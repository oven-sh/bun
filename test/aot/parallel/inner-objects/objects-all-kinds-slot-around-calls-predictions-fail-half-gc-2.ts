// Each field of these objects is of another kind: booleans, whole numbers, fractions, one of a few texts, texts, objects, anything, each also optional. An object or a short list in a field is made first,
// and what fills the fields behind it splits texts, joins lists and parses, so collections fall between the two. The objects come from literals, constructors, class fields, spreads and `JSON.parse(text) as T`.
// Env: BUN_JSC_validateAOTRuntime=1
// Env: BUN_JSC_slowPathAllocsBetweenGCs=10
// Env: BUN_JSC_useConcurrentGC=0
// Flags: --aot-testing=FailPredictions:2:2
// Env of the executable: BUN_JSC_slowPathAllocsBetweenGCs=2
// Env of the executable: BUN_JSC_useZombieMode=1
// Env of the executable: BUN_JSC_scribbleFreeCells=1
// Env of the executable: BUN_JSC_useEdenCollectionsAtSlowPathAllocs=1
// Erased types: not built: objects-all-kinds-slot-around-calls is built so
type Color = "red" | "green" | "blue";
interface Inner { count: number; text: string }
interface Wide {
  inner: Inner;
  flag: boolean; maybeFlag?: boolean;
  whole: number; maybeWhole?: number;
  fraction: number; maybeFraction?: number;
  color: Color; maybeColor?: Color;
  text: string; maybeText?: string;
  other: Inner | null; maybeOther?: Inner;
  anything: unknown; maybeAnything?: unknown;
  parts: string[];
}
interface WithList { list: number[]; flag: boolean; maybeFlag?: boolean; color: Color; whole: number; parts: string[] }

const colors: Color[] = ["red", "green", "blue"];
const inners: Inner[] = [];
const lists: number[][] = [];

function keep(inner: Inner): Inner {
  inners.push(inner);
  return inner;
}

function fromLiteral(i: number, text: string): Wide {
  const inner = keep({ count: i, text: "t" + i });
  const parts = text.split(/,/);
  return {
    inner, flag: i % 2 === 0, whole: parts.length + i, fraction: i / 4, color: colors[i % 3], text: parts.join("-"),
    other: i % 3 === 0 ? null : { count: -i, text: parts[0] }, anything: i % 5 === 0 ? parts : i, parts,
  };
}

function withOptionalFields(i: number, text: string): Wide {
  const inner = keep({ count: i, text: "u" + i });
  const parts = text.split(/;/);
  return {
    inner, flag: i % 2 === 1, maybeFlag: i % 3 === 0, whole: i, maybeWhole: i % 7 === 0 ? undefined : i * 2, fraction: i / 8, maybeFraction: i / 16,
    color: colors[(i + 1) % 3], maybeColor: colors[i % 3], text: parts.join("+"), maybeText: "m" + parts.length, other: null, maybeOther: { count: i, text: "o" + i },
    anything: null, maybeAnything: parts.length > 1 ? parts[1] : undefined, parts,
  };
}

function withList(i: number, text: string): WithList {
  const list = [i, i + 1, i + 2];
  lists.push(list);
  const parts = text.split(/,/);
  return { list, flag: parts.length > 3, color: colors[i % 3], whole: parts.length, parts };
}

class Made {
  inner: Inner;
  flag = false;
  maybeFlag?: boolean;
  whole = 0;
  color: Color = "red";
  parts: string[];
  constructor(i: number, text: string) {
    this.inner = keep({ count: i, text: "c" + i });
    this.parts = text.split(/,/);
    this.flag = this.parts.length % 2 === 0;
    this.whole = this.parts.length + i;
    if (i % 4 === 0) this.maybeFlag = i % 8 === 0;
    this.color = colors[i % 3];
  }
}

function describe(wide: Wide): string {
  return [
    wide.inner.count, wide.inner.text, wide.flag, wide.maybeFlag, wide.whole, wide.maybeWhole, wide.fraction, wide.maybeFraction, wide.color, wide.maybeColor, wide.text, wide.maybeText,
    wide.other === null ? "none" : wide.other.text, wide.maybeOther?.text, typeof wide.anything, typeof wide.maybeAnything, wide.parts.length,
  ].join(" ");
}

let length = 0;
let last = "";
const kept: unknown[] = [];
for (let i = 0; i < 300; i++) {
  const first = fromLiteral(i, "a,b,c," + i);
  const second = withOptionalFields(i, "x;y;" + i);
  const copy: Wide = { ...first, maybeFlag: i % 2 === 0, parts: second.text.split(/\+/) };
  const parsed = JSON.parse(JSON.stringify(second)) as Wide;
  const listed = withList(i, "p,q,r,s," + i);
  const made = new Made(i, "k,l," + i);
  last = [describe(first), describe(second), describe(copy), describe(parsed), listed.list.join(), listed.flag, listed.maybeFlag, listed.color, listed.whole, made.inner.text, made.flag, made.maybeFlag, made.whole, made.color].join(" | ");
  length += last.length;
  if (i % 3 === 0) kept.push(first, second, copy, parsed, listed, made);
}
console.log(length, kept.length, inners.length, lists.length);
console.log(last);
