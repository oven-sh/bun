// Untyped code reads and stores the declared fields of typed objects by name, in loops. The first accesses enter the run time, all others are answered by the caches, and the objects keep their layout.
// COUNTER: StoreOfOtherType = 0
// COUNTER: RedefinedProperty = 0
declare const aotOperationCount: undefined | ((name: string) => number);
const countOf = typeof aotOperationCount === "function" ? aotOperationCount : null;   // Only the jsc shell can count. Elsewhere the program checks the answers alone.
function calls(...names: string[]): number { let sum = 0; if (countOf) for (const name of names) sum += countOf("operationAOT" + name); return sum; }
function expectBetween(what: string, value: number, low: number, high: number): void { if (countOf && !(value >= low && value <= high)) throw new Error(what + ": " + value + " is not in " + low + ".." + high); }
function entries(): number { return calls("GetByIdAndCache", "PutByIdAndCache"); }
function fills(): number { return calls("FillSiteCache"); }

const trips: number = JSON.parse("10000");
const box: any[] = JSON.parse("[0]");
function hidden(value: unknown): any { box[0] = value; return box[0]; }

class Sample {
  flag: boolean = true;
  real: number = 0.5;
  text: string = "a";
  link: Sample | null = null;
  loose: any = 0;
}

function readFlag(o: any, n: number): number { let sum = 0; for (let i = 0; i < n; i++) sum += o.flag ? 1 : 0; return sum; }
function readReal(o: any, n: number): number { let sum = 0; for (let i = 0; i < n; i++) sum += o.real; return sum; }
function readText(o: any, n: number): number { let sum = 0; for (let i = 0; i < n; i++) sum += o.text === "a" ? 1 : 2; return sum; }
function readLink(o: any, n: number): number { let sum = 0; for (let i = 0; i < n; i++) sum += o.link === null ? 1 : 2; return sum; }
function readLoose(o: any, n: number): number { let sum = 0; for (let i = 0; i < n; i++) sum += o.loose === 0 ? 1 : 2; return sum; }
function storeFlag(o: any, n: number): void { for (let i = 0; i < n; i++) o.flag = (i & 1) === 0; }
function storeReal(o: any, n: number): void { for (let i = 0; i < n; i++) o.real = i + 0.25; }
function storeText(o: any, values: any[], n: number): void { for (let i = 0; i < n; i++) o.text = values[i & 1]; }
function storeLink(o: any, values: any[], n: number): void { for (let i = 0; i < n; i++) o.link = values[i & 1]; }
function storeLoose(o: any, values: any[], n: number): void { for (let i = 0; i < n; i++) o.loose = values[i & 3]; }

// Each run has one access by name. A site cache cannot hold a field, so the access asks the table that all sites share, and the site tries to fill itself less and less often.
function measure(what: string, run: () => unknown): void {
  const entriesBefore = entries();
  const fillsBefore = fills();
  const result = run();
  expectBetween(what + ", entries", entries() - entriesBefore, 0, 8);
  expectBetween(what + ", attempts to fill the site cache", fills() - fillsBefore, 0, 60);
  console.log(what + ": " + String(result));
}

function measureAll(label: string, sample: Sample): void {
  const o = hidden(sample);
  const texts = hidden(["b", "c"]);
  const links = hidden([sample, null]);
  const values = hidden([1, "s", null, sample]);
  measure(label + ", flag read", () => readFlag(o, trips));
  measure(label + ", real read", () => readReal(o, trips));
  measure(label + ", text read", () => readText(o, trips));
  measure(label + ", link read", () => readLink(o, trips));
  measure(label + ", loose read", () => readLoose(o, trips));
  measure(label + ", flag stored", () => (storeFlag(o, trips), sample.flag));
  measure(label + ", real stored", () => (storeReal(o, trips), sample.real));
  measure(label + ", text stored", () => (storeText(o, texts, trips), sample.text));
  measure(label + ", link stored", () => (storeLink(o, links, trips), sample.link === null));
  measure(label + ", loose stored", () => (storeLoose(o, values, trips), sample.loose === sample));
  measure(label + ", flag read again", () => readFlag(o, trips));
  measure(label + ", real read again", () => readReal(o, trips));
  measure(label + ", text read again", () => readText(o, trips));
  measure(label + ", link read again", () => readLink(o, trips));
  measure(label + ", loose read again", () => readLoose(o, trips));
}

measureAll("first object", new Sample());
measureAll("second object", new Sample());
export {};
