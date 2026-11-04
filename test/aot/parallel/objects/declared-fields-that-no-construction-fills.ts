// Env: BUN_JSC_verifyGC=1
// A type declares a hundred optional properties and every construction gives a few of them a value: the others are stored late, by name, by key, by a copy, by a descriptor, or never.
interface Wide {
  first: number;
  p0?: number;
  p1?: string;
  p2?: boolean;
  p3?: number[];
  p4?: Wide;
  p5?: { deep: number };
  p6?: undefined | number;
  p7?: number;
  p8?: string;
  p9?: boolean;
  p10?: number[];
  p11?: Wide;
  p12?: { deep: number };
  p13?: undefined | number;
  p14?: number;
  p15?: string;
  p16?: boolean;
  p17?: number[];
  p18?: Wide;
  p19?: { deep: number };
  p20?: undefined | number;
  p21?: number;
  p22?: string;
  p23?: boolean;
  p24?: number[];
  p25?: Wide;
  p26?: { deep: number };
  p27?: undefined | number;
  p28?: number;
  p29?: string;
  p30?: boolean;
  p31?: number[];
  p32?: Wide;
  p33?: { deep: number };
  p34?: undefined | number;
  p35?: number;
  p36?: string;
  p37?: boolean;
  p38?: number[];
  p39?: Wide;
  p40?: { deep: number };
  p41?: undefined | number;
  p42?: number;
  p43?: string;
  p44?: boolean;
  p45?: number[];
  p46?: Wide;
  p47?: { deep: number };
  p48?: undefined | number;
  p49?: number;
  p50?: string;
  p51?: boolean;
  p52?: number[];
  p53?: Wide;
  p54?: { deep: number };
  p55?: undefined | number;
  p56?: number;
  p57?: string;
  p58?: boolean;
  p59?: number[];
  p60?: Wide;
  p61?: { deep: number };
  p62?: undefined | number;
  p63?: number;
  p64?: string;
  p65?: boolean;
  p66?: number[];
  p67?: Wide;
  p68?: { deep: number };
  p69?: undefined | number;
  p70?: number;
  p71?: string;
  p72?: boolean;
  p73?: number[];
  p74?: Wide;
  p75?: { deep: number };
  p76?: undefined | number;
  p77?: number;
  p78?: string;
  p79?: boolean;
  p80?: number[];
  p81?: Wide;
  p82?: { deep: number };
  p83?: undefined | number;
  p84?: number;
  p85?: string;
  p86?: boolean;
  p87?: number[];
  p88?: Wide;
  p89?: { deep: number };
  p90?: undefined | number;
  p91?: number;
  p92?: string;
  p93?: boolean;
  p94?: number[];
  p95?: Wide;
  p96?: { deep: number };
  p97?: undefined | number;
  p98?: number;
  p99?: string;
  last?: string;
}

interface Narrow { a: number; b?: string; c?: number; d?: Narrow; e?: number; f?: number; g?: boolean }
class Reader { position?: number; name: string; buffer?: number[]; mark?: number; limit?: number; owner?: Reader; constructor(name: string) { this.name = name; } open() { this.position = 0; this.buffer = [1]; return this; } }

function one(first: number): Wide { return { first }; }
function two(first: number): Wide { return { first, p3: [first], p7: first / 2 }; }
function three(first: number): Wide { const made: Wide = { first, last: "l" + first }; made.p1 = "s" + first; return made; }
const makers = [one, two, three];
function describe(o: object): string {
  const parts: string[] = [];
  for (const key in o) parts.push(key);
  return Object.keys(o).join() + "|" + parts.length + "|" + JSON.stringify(o);
}
function sum(w: Wide): number {
  return w.first + (w.p0 ?? 0) + (w.p7 ?? 0) + (w.p14 ?? 0) + (w.p21 ?? 0) + (w.p98 ?? 0) + (w.p3 ? w.p3.length : 0) + (w.p5 ? w.p5.deep : 0) + (w.p1 ? w.p1.length : 0) + (w.last ? 1 : 0);
}
const kept: Wide[] = [];
let total = 0;
let text = "";
function add(value: unknown) { const number = Number(value); total = (total + (number === number ? number : String(value).length)) % 1000000007; }
for (let round = 0; round < 3000; round++) {
  const w = makers[round % 3](round);
  if (round % 5 === 0) w.p0 = round;
  if (round % 7 === 0) { w.p14 = round + 0.5; w.p21 = round; w.p98 = -round; }
  if (round % 11 === 0) w.p5 = { deep: round };
  if (round % 13 === 0) (w as any)["p" + (round % 100)] = round % 2 ? "by key" : round;
  if (round % 17 === 0) w.p6 = undefined;
  if (round % 19 === 0) w.p4 = kept[kept.length >> 1];
  if (round % 23 === 0) delete w.p0;
  if (round % 29 === 0) Object.defineProperty(w, "p9", { get() { return "got " + this.first; }, set(value) { this.p16 = "set " + value; }, enumerable: true, configurable: true });
  if (round % 31 === 0) Object.assign(w, { p10: [1, 2], p11: w, p12: { deep: 1 } });
  if (round % 37 === 0) Object.freeze(w);
  add(sum(w));
  if (round % 41 === 0) { const copy: Wide = { ...w, p2: true }; add(sum(copy)); text += ("p11" in copy) + " " + Object.keys(copy).length + " " + copy.hasOwnProperty("p6") + " " + (copy.p6 === undefined) + "\n"; }
  if (round % 3 === 0 || round % 31 === 0) kept.push(w);
  if (round < 45 && round % 31 !== 0) text += describe(w) + "\n";
  if (round % 1000 === 999) Bun.gc(true);
}

function fill(w: Wide, seed: number) {
  w.p0 = seed + 0;
  w.p1 = "t" + seed;
  w.p2 = seed % 2 === 0;
  w.p3 = [seed];
  w.p4 = w;
  w.p5 = { deep: seed };
  w.p6 = undefined;
  w.p7 = seed + 7;
  w.p8 = "t" + seed;
  w.p9 = seed % 2 === 0;
  w.p10 = [seed];
  w.p11 = w;
  w.p12 = { deep: seed };
  w.p13 = undefined;
  w.p14 = seed + 14;
  w.p15 = "t" + seed;
  w.p16 = seed % 2 === 0;
  w.p17 = [seed];
  w.p18 = w;
  w.p19 = { deep: seed };
  w.p20 = undefined;
  w.p21 = seed + 21;
  w.p22 = "t" + seed;
  w.p23 = seed % 2 === 0;
  w.p24 = [seed];
  w.p25 = w;
  w.p26 = { deep: seed };
  w.p27 = undefined;
  w.p28 = seed + 28;
  w.p29 = "t" + seed;
  w.p30 = seed % 2 === 0;
  w.p31 = [seed];
  w.p32 = w;
  w.p33 = { deep: seed };
  w.p34 = undefined;
  w.p35 = seed + 35;
  w.p36 = "t" + seed;
  w.p37 = seed % 2 === 0;
  w.p38 = [seed];
  w.p39 = w;
  w.p40 = { deep: seed };
  w.p41 = undefined;
  w.p42 = seed + 42;
  w.p43 = "t" + seed;
  w.p44 = seed % 2 === 0;
  w.p45 = [seed];
  w.p46 = w;
  w.p47 = { deep: seed };
  w.p48 = undefined;
  w.p49 = seed + 49;
  w.p50 = "t" + seed;
  w.p51 = seed % 2 === 0;
  w.p52 = [seed];
  w.p53 = w;
  w.p54 = { deep: seed };
  w.p55 = undefined;
  w.p56 = seed + 56;
  w.p57 = "t" + seed;
  w.p58 = seed % 2 === 0;
  w.p59 = [seed];
  w.p60 = w;
  w.p61 = { deep: seed };
  w.p62 = undefined;
  w.p63 = seed + 63;
  w.p64 = "t" + seed;
  w.p65 = seed % 2 === 0;
  w.p66 = [seed];
  w.p67 = w;
  w.p68 = { deep: seed };
  w.p69 = undefined;
  w.p70 = seed + 70;
  w.p71 = "t" + seed;
  w.p72 = seed % 2 === 0;
  w.p73 = [seed];
  w.p74 = w;
  w.p75 = { deep: seed };
  w.p76 = undefined;
  w.p77 = seed + 77;
  w.p78 = "t" + seed;
  w.p79 = seed % 2 === 0;
  w.p80 = [seed];
  w.p81 = w;
  w.p82 = { deep: seed };
  w.p83 = undefined;
  w.p84 = seed + 84;
  w.p85 = "t" + seed;
  w.p86 = seed % 2 === 0;
  w.p87 = [seed];
  w.p88 = w;
  w.p89 = { deep: seed };
  w.p90 = undefined;
  w.p91 = seed + 91;
  w.p92 = "t" + seed;
  w.p93 = seed % 2 === 0;
  w.p94 = [seed];
  w.p95 = w;
  w.p96 = { deep: seed };
  w.p97 = undefined;
  w.p98 = seed + 98;
  w.p99 = "t" + seed;
}

let wrong = 0;
for (let i = 0; i < kept.length; i += 9) {
  const w = kept[i];
  if (Object.isFrozen(w)) continue;
  const before = Object.keys(w).length;
  fill(w, i);
  const keys = Object.keys(w);
  if (keys.length < 101 || keys.length < before || w.p0 !== i || w.p99 !== "t" + i || w.p15 !== "t" + i || w.p98 !== i + 98 || w.p4 !== w || !("p6" in w) || w.p6 !== undefined) wrong++;
}
Bun.gc(true);
for (const w of kept) add(sum(w));

const narrow: Narrow[] = [];
for (let i = 0; i < 2000; i++) {
  const n: Narrow = { a: i };
  if (i & 1) n.b = "b" + i;
  if (i & 2) n.c = i;
  if (i & 4) n.d = narrow[i >> 1];
  if (i & 8) { n.e = i / 4; n.f = i; n.g = true; }
  narrow.push(n);
}
let folded = 0;
for (const n of narrow) folded += n.a + (n.b ? n.b.length : 0) + (n.c ?? 0) + (n.d ? n.d.a : 0) + (n.e ?? 0) + (n.f ?? 0) + (n.g ? 1 : 0) + Object.keys(n).length;

const readers: Reader[] = [];
for (let i = 0; i < 2000; i++) {
  const r = new Reader("r" + i);
  if (i % 2) r.open();
  if (i % 3 === 0) r.mark = i;
  if (i % 5 === 0) { r.limit = i; r.owner = readers[i >> 1]; }
  readers.push(r);
}
let read = 0;
for (const r of readers) read += (r.position ?? -1) + (r.buffer ? r.buffer.length : 0) + (r.mark ?? 0) + (r.limit ?? 0) + (r.owner ? r.owner.name.length : 0) + Object.keys(r).length;
console.log(text + total + " " + wrong + " " + kept.length + " " + folded + " " + read);

