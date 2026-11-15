// An instance of a class below Map or Set never bears the mark "as its class made it". The stubs of the built-in's methods take it all the same while its structure is kept:
// every method is found on the built-in's own prototype. Each case takes that away in another way, or asks at a time at which the table may not be asked.
import { buildBothWays } from "./build-both-ways";

const tells = `const counts = new Map<string, number>();
const note = (what: unknown): void => { const key = String(what); counts.set(key, (counts.get(key) ?? 0) + 1); };
const say = (): void => { console.log([...counts].map(([key, times]) => key + "x" + times).join(" ")); counts.clear(); };
`;

buildBothWays("compile/aot/methods of instances of classes below Map and Set", {
  "the method is read in front of operands that take the laid one away": {
    alone: true,
    files: {
      "main.ts": `${tells}class Ledger extends Map<string, string> {}
function lay(): void { (Ledger.prototype as any).get = function () { return "laid"; }; (Ledger.prototype as any).set = function (this: unknown) { note("laid set"); return this; }; }
const one = new Ledger([["a", "map's"]]), other = new Ledger();
function takeBack(): string { delete (Ledger.prototype as any).get; delete (Ledger.prototype as any).set; for (let i = 0; i < 300; i++) { other.has("a"); other.get("a"); other.set("b", "c"); } return "a"; }
function ask(): void { note(one.get(takeBack())); }
function put(): void { one.set(takeBack(), "put"); note(one.get("a")); }
for (let round = 0; round < 5; round++) { lay(); ask(); say(); lay(); put(); say(); note(one.get("a")); say(); }
`,
    },
    prints:
      "laidx1\nlaid setx1 map'sx1\nmap'sx1\nlaidx1\nlaid setx1 map'sx1\nmap'sx1\nlaidx1\nlaid setx1 map'sx1\nmap'sx1\nlaidx1\nlaid setx1 map'sx1\nmap'sx1\nlaidx1\nlaid setx1 map'sx1\nmap'sx1\n",
  },
  "the same across an await": {
    alone: true,
    files: {
      "main.ts": `${tells}class Ledger extends Map<string, string> {}
const one = new Ledger([["a", "map's"]]), other = new Ledger();
let laid = 0;
function lay(): void { (Ledger.prototype as any).set = function (this: Map<string, string>, key: string, value: string) { laid++; return Map.prototype.set.call(this, key, "laid " + value); }; }
async function later(): Promise<string> { await null; delete (Ledger.prototype as any).set; for (let i = 0; i < 300; i++) { other.has("a"); other.set("b", "c"); } return "value"; }
async function put(): Promise<void> { one.set("k", await later()); }
for (let round = 0; round < 5; round++) { lay(); await put(); note(one.get("k")); note(laid); say(); }
`,
    },
    prints: "laid valuex1 1x1\nlaid valuex1 2x1\nlaid valuex1 3x1\nlaid valuex1 4x1\nlaid valuex1 5x1\n",
  },
  "the first that comes has the name for its own": {
    alone: true,
    files: {
      "main.ts": `${tells}class Tracked extends Map<string, number> {}
const odd = new Tracked(); (odd as any).clear = function () { note("own clear"); }; (odd as any).has = () => "own has";
const all: Map<string, number>[] = [odd];
function sweep(): void { for (const one of all) { one.set("a", 1); note(one.size); one.clear(); note(one.has("a")); } }
function phase(): void { for (let turn = 0; turn < 300; turn++) sweep(); say(); }
phase(); all.push(new Tracked(), new Map()); phase(); delete (odd as any).clear; phase(); delete (odd as any).has; phase();
`,
    },
    prints:
      "1x300 own clearx300 own hasx300\n1x900 own clearx300 own hasx300 falsex600\n1x900 own hasx300 falsex600\n1x900 falsex900\n",
  },
  "two prototypes between, and the upper one changes": {
    alone: true,
    files: {
      "main.ts": `${tells}class Middle extends Map<string, number> { helper(): string { return "helper"; } }
class Leaf extends Middle { other(): string { return "other"; } }
const all: Map<string, number>[] = [new Leaf(), new Middle(), new Map(), new Leaf()];
function sweep(): void { for (const one of all) { one.set("a", 1); one.clear(); note(one.has("a")); note(one.size); } }
function phase(): void { for (let turn = 0; turn < 300; turn++) sweep(); say(); }
phase(); (Middle.prototype as any).clear = function (this: Map<string, number>) { note("middle"); Map.prototype.clear.call(this); }; phase();
delete (Middle.prototype as any).clear; phase(); (Leaf.prototype as any).unrelated = 1; phase(); (Leaf.prototype as any).has = () => "leaf has"; phase();
Object.setPrototypeOf(Leaf.prototype, Map.prototype); phase(); delete (Leaf.prototype as any).has; phase();
`,
    },
    prints:
      "falsex1200 0x1200\nmiddlex900 falsex1200 0x1200\nfalsex1200 0x1200\nfalsex1200 0x1200\nleaf hasx600 0x1200 falsex600\nleaf hasx600 0x1200 falsex600\nfalsex1200 0x1200\n",
  },
  "more classes alive than the table has places": {
    alone: true,
    files: {
      "main.ts": `${tells}function make(round: number): new () => Map<string, number> { return round % 5 === 4 ? class extends Map<string, number> { clear(): void { note("laid"); super.clear(); } } : class extends Map<string, number> {}; }
const all: Map<string, number>[] = [];
for (let i = 0; i < 150; i++) all.push(new (make(i))());
function sweep(): void { for (const one of all) { one.set("a", 1); one.clear(); note(one.has("a")); } }
for (let turn = 0; turn < 60; turn++) sweep(); say();
Object.getPrototypeOf(all[0]).has = () => "first has"; Object.getPrototypeOf(all[64]).has = () => "sixty-fifth has"; Object.getPrototypeOf(all[128]).has = () => "hundred and twenty-ninth has";
for (let turn = 0; turn < 60; turn++) sweep(); say();
`,
    },
    prints:
      "falsex9000 laidx1800\nfirst hasx60 falsex8820 laidx1800 sixty-fifth hasx60 hundred and twenty-ninth hasx60\n",
  },
});
