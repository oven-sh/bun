// RUN: lower
// OPTIONS: builtin-modules

// Control flow of many shapes.
// control-flow.py seed 26
const log: string[] = [];
function say(s: string): void { log.push(s); }
function t<T>(label: string, value: T): T { log.push(label); return value; }
function num(x: unknown): string { return typeof x === "number" ? (Object.is(x, -0) ? "-0" : String(x)) : typeof x === "string" ? "'" + x + "'" : Array.isArray(x) ? "[" + x.map(num).join() + "]" : String(x); }
function attempt(f: () => unknown): string { try { return num(f()); } catch (e) { return "threw " + (e instanceof Error ? e.constructor.name + ":" + e.message : num(e)); } }
function counter(name: string, n: number, failAt = -1): Iterable<number> & { closed: number } {
  const self = { closed: 0, [Symbol.iterator](): Iterator<number> {
    let i = 0;
    return { next(): IteratorResult<number> { say(name + ".next" + i); if (i === failAt) throw new Error(name + " failed"); return i < n ? { value: i++, done: false } : { value: undefined, done: true }; },
      return(v?: unknown): IteratorResult<number> { say(name + ".return"); self.closed++; return { value: v as any, done: true }; } };
  } };
  return self;
}
function* gen(name: string, n: number): Generator<number, string, unknown> { try { for (let i = 0; i < n; i++) { say(name + " yields " + i); const got = yield i; if (got !== undefined) say(name + " got " + num(got)); } return name + " done"; } finally { say(name + " finally"); } }
class Box { v = 1; w = 10; list = [1, 2, 3]; inner: Box | null = null; get g(): number { say("get g"); return this.v; } set g(x: number) { say("set g " + x); this.v = x; } m(x: number): number { say("m " + x); return x + this.v; } }

function add3(a: number, b: number, c: number): number { return a * 100 + b * 10 + c; }
const maybe: ((x: number) => number) | undefined = undefined as ((x: number) => number) | undefined;
function tag(strings: TemplateStringsArray, ...values: unknown[]): string { return strings.join("|") + values.join(",") + strings.raw.length; }
function f0(k: number): string {
  let n = 0;
  L2: for (const i3 of counter("s1", 3, 0)) {
  L5: for (const i6 of counter("s4", 3, 0)) {
  say("s7"); n++;
  say("s8"); n++;
  }
  try {
  if (k % 2 === 0) continue;
  B14: {
  say("s15"); n++;
  }
  L17: for (const [i18] of new Map([[1, 2], [3, 4]])) {
  say("s19"); n++;
  say("s20"); n++;
  }
  say("s21"); n++;
  } catch (e) { say("s9 caught " + (e as Error).message);
  } finally { say("s9 finally");
  }
  }
  say("s22"); n++;
  return "end" + n;
}
function f1(k: number): string {
  let n = 0;
  say("s23"); n++;
  return "end" + n;
}
function f2(k: number): string {
  let n = 0;
  say("s24"); n++;
  return "end" + n;
}
function f3(k: number): string {
  let n = 0;
  if (k === 0) return "r26";
  try {
  try {
  if (n % 2) {
  say("s31"); n++;
  say("s32"); n++;
  say("s33"); n++;
  say("s34"); n++;
  } else {
  say("s35"); n++;
  }
  } finally { say("s29 finally");
  if (n === 1) throw new Error("e38");
  try {
  say("s40"); n++;
  } catch (e) { say("s39 caught " + (e as Error).message);
  say("s41"); n++;
  }
  { let i44 = 0;
  L43: do {
  say("s45"); n++;
  } while (i44++ < 2);
  }
  B47: {
  say("s48"); n++;
  }
  }
  } catch (e) { say("s28 caught " + (e as Error).message);
  B50: switch (n % 3) {
  case 0:
  L52: for (const i53 of "ab") {
  say("s54"); n++;
  say("s55"); n++;
  say("s56"); n++;
  say("s57"); n++;
  }
  case 1:
  say("s58"); n++;
  break;
  default:
  if (k % 3 === 1) return "r60";
  try {
  say("s63"); n++;
  say("s64"); n++;
  say("s65"); n++;
  } finally { say("s62 finally");
  }
  say("s66"); n++;
  say("s67"); n++;
  }
  if (k % 3 === 1) return "r69";
  } finally { say("s28 finally");
  try {
  if (k % 2 === 0) return "r73";
  say("s75"); n++;
  say("s76"); n++;
  say("s77"); n++;
  } catch (e) { say("s71 caught " + (e as Error).message);
  B79: {
  say("s80"); n++;
  }
  try {
  say("s82"); n++;
  } finally { say("s81 finally");
  say("s83"); n++;
  say("s84"); n++;
  }
  } finally { say("s71 finally");
  L86: for (const i87 of counter("s85", 3, 2)) {
  say("s88"); n++;
  say("s89"); n++;
  say("s90"); n++;
  }
  say("s91"); n++;
  }
  if (k === 0) return "r93";
  say("s95"); n++;
  { let i98 = 0;
  L97: do {
  try {
  say("s100"); n++;
  say("s101"); n++;
  say("s102"); n++;
  say("s103"); n++;
  } catch (e) { say("s99 caught " + (e as Error).message);
  say("s104"); n++;
  } finally { say("s99 finally");
  say("s105"); n++;
  }
  L107: for (const i108 of new Set([1, 2])) {
  say("s109"); n++;
  }
  try {
  say("s111"); n++;
  say("s112"); n++;
  } catch (e) { say("s110 caught " + (e as Error).message);
  } finally { say("s110 finally");
  }
  } while (i98++ < 2);
  }
  }
  return "end" + n;
}
function f4(k: number): string {
  let n = 0;
  L114: for (const i115 of [1, 2, 3]) {
  { let i118 = 0;
  L117: do {
  say("s119"); n++;
  try {
  say("s121"); n++;
  say("s122"); n++;
  } catch (e) { say("s120 caught " + (e as Error).message);
  say("s123"); n++;
  } finally { say("s120 finally");
  say("s124"); n++;
  say("s125"); n++;
  }
  L127: for (const i128 of new Set([1, 2])) {
  say("s129"); n++;
  say("s130"); n++;
  say("s131"); n++;
  say("s132"); n++;
  }
  L134: for (const i135 of counter("s133", 3, 3)) {
  say("s136"); n++;
  }
  } while (i118++ < 2);
  }
  try {
  if (n % 2) {
  say("s139"); n++;
  say("s140"); n++;
  } else {
  say("s141"); n++;
  say("s142"); n++;
  say("s143"); n++;
  }
  } catch (e) { say("s137 caught " + (e as Error).message);
  } finally { say("s137 finally");
  }
  L145: for (let i146 = 0; i146 < 3; i146++) {
  say("s147"); n++;
  if (n % 2) {
  say("s149"); n++;
  say("s150"); n++;
  say("s151"); n++;
  } else {
  say("s152"); n++;
  say("s153"); n++;
  say("s154"); n++;
  }
  if (n % 2) {
  say("s156"); n++;
  say("s157"); n++;
  } else {
  say("s158"); n++;
  say("s159"); n++;
  say("s160"); n++;
  say("s161"); n++;
  }
  }
  }
  B163: switch (n % 3) {
  case 0:
  try {
  { let i167 = 0;
  L166: do {
  say("s168"); n++;
  say("s169"); n++;
  } while (i167++ < 2);
  }
  } finally { say("s164 finally");
  if (k % 2 === 0) break B163;
  try {
  say("s174"); n++;
  } catch (e) { say("s173 caught " + (e as Error).message);
  } finally { say("s173 finally");
  }
  }
  L176: for (const [i177] of new Map([[1, 2], [3, 4]])) {
  if (k === 0) break L176;
  B182: switch (n % 3) {
  case 0:
  say("s183"); n++;
  say("s184"); n++;
  say("s185"); n++;
  say("s186"); n++;
  case 1:
  say("s187"); n++;
  say("s188"); n++;
  say("s189"); n++;
  break;
  default:
  say("s190"); n++;
  say("s191"); n++;
  }
  say("s192"); n++;
  say("s193"); n++;
  }
  if (k % 3 === 1) return "r195";
  if (true) return "r198";
  case 1:
  B201: {
  try {
  say("s203"); n++;
  say("s204"); n++;
  say("s205"); n++;
  say("s206"); n++;
  } catch (e) { say("s202 caught " + (e as Error).message);
  } finally { say("s202 finally");
  }
  say("s207"); n++;
  }
  { let i210 = 0;
  L209: do {
  say("s211"); n++;
  say("s212"); n++;
  L214: for (const i215 of "ab") {
  say("s216"); n++;
  }
  } while (i210++ < 2);
  }
  if (k === 0) throw new Error("e219");
  
  default:
  try {
  B222: switch (n % 3) {
  case 0:
  say("s223"); n++;
  say("s224"); n++;
  say("s225"); n++;
  case 1:
  say("s226"); n++;
  say("s227"); n++;
  say("s228"); n++;
  say("s229"); n++;
  
  default:
  say("s230"); n++;
  }
  say("s231"); n++;
  B233: switch (n % 3) {
  case 0:
  say("s234"); n++;
  say("s235"); n++;
  say("s236"); n++;
  say("s237"); n++;
  case 1:
  say("s238"); n++;
  say("s239"); n++;
  say("s240"); n++;
  say("s241"); n++;
  
  default:
  say("s242"); n++;
  say("s243"); n++;
  say("s244"); n++;
  say("s245"); n++;
  }
  B247: switch (n % 3) {
  case 0:
  say("s248"); n++;
  case 1:
  say("s249"); n++;
  break;
  default:
  say("s250"); n++;
  say("s251"); n++;
  }
  } finally { say("s220 finally");
  try {
  say("s253"); n++;
  } finally { say("s252 finally");
  say("s254"); n++;
  say("s255"); n++;
  }
  if (true) return "r257";
  }
  L260: for (const i261 of new Set([1, 2])) {
  if (k === 0) break B163;
  L266: for (const i267 of new Set([1, 2])) {
  say("s268"); n++;
  }
  }
  try {
  say("s270"); n++;
  L272: for (const i273 of gen("s271", 3)) {
  say("s274"); n++;
  }
  say("s275"); n++;
  } finally { say("s269 finally");
  L277: for (const i278 of counter("s276", 3, 1)) {
  say("s279"); n++;
  say("s280"); n++;
  say("s281"); n++;
  }
  L283: for (const i284 of counter("s282", 3)) {
  say("s285"); n++;
  say("s286"); n++;
  say("s287"); n++;
  }
  try {
  say("s289"); n++;
  say("s290"); n++;
  say("s291"); n++;
  } finally { say("s288 finally");
  say("s292"); n++;
  }
  }
  }
  try {
  try {
  L296: for (let i297 = 0; i297 < 1; i297++) {
  say("s298"); n++;
  }
  } catch (e) { say("s294 caught " + (e as Error).message);
  if (n % 2) {
  say("s300"); n++;
  say("s301"); n++;
  say("s302"); n++;
  } else {
  say("s303"); n++;
  say("s304"); n++;
  say("s305"); n++;
  say("s306"); n++;
  }
  }
  if (n > 2) throw new Error("e309");
  } finally { say("s293 finally");
  try {
  B312: {
  say("s313"); n++;
  say("s314"); n++;
  }
  } finally { say("s310 finally");
  if (true) throw new Error("e317");
  L319: for (const i320 of new Set([1, 2])) {
  say("s321"); n++;
  say("s322"); n++;
  say("s323"); n++;
  say("s324"); n++;
  }
  }
  }
  try {
  try {
  say("s327"); n++;
  if (n % 2) {
  say("s329"); n++;
  say("s330"); n++;
  say("s331"); n++;
  say("s332"); n++;
  } else {
  say("s333"); n++;
  say("s334"); n++;
  }
  B336: {
  say("s337"); n++;
  say("s338"); n++;
  }
  if (n > 2) throw new Error("e341");
  } catch (e) { say("s326 caught " + (e as Error).message);
  } finally { say("s326 finally");
  }
  B343: switch (n % 3) {
  case 0:
  if (k === 0) break B343;
  if (k % 3 === 1) return "r348";
  say("s350"); n++;
  L352: for (const i353 of counter("s351", 3)) {
  say("s354"); n++;
  say("s355"); n++;
  say("s356"); n++;
  }
  case 1:
  L358: for (const [i359] of new Map([[1, 2], [3, 4]])) {
  say("s360"); n++;
  say("s361"); n++;
  say("s362"); n++;
  say("s363"); n++;
  }
  B365: switch (n % 3) {
  case 0:
  say("s366"); n++;
  say("s367"); n++;
  say("s368"); n++;
  case 1:
  say("s369"); n++;
  say("s370"); n++;
  say("s371"); n++;
  say("s372"); n++;
  break;
  default:
  say("s373"); n++;
  }
  if (n % 2) {
  say("s375"); n++;
  say("s376"); n++;
  } else {
  say("s377"); n++;
  say("s378"); n++;
  say("s379"); n++;
  say("s380"); n++;
  }
  break;
  default:
  try {
  say("s382"); n++;
  say("s383"); n++;
  say("s384"); n++;
  } catch (e) { say("s381 caught " + (e as Error).message);
  say("s385"); n++;
  say("s386"); n++;
  say("s387"); n++;
  say("s388"); n++;
  } finally { say("s381 finally");
  say("s389"); n++;
  say("s390"); n++;
  say("s391"); n++;
  }
  try {
  say("s393"); n++;
  say("s394"); n++;
  say("s395"); n++;
  } catch (e) { say("s392 caught " + (e as Error).message);
  } finally { say("s392 finally");
  }
  if (n % 2) {
  say("s397"); n++;
  } else {
  say("s398"); n++;
  }
  try {
  say("s400"); n++;
  say("s401"); n++;
  say("s402"); n++;
  say("s403"); n++;
  } catch (e) { say("s399 caught " + (e as Error).message);
  say("s404"); n++;
  say("s405"); n++;
  } finally { say("s399 finally");
  }
  }
  if (k === 0) return "r407";
  if (n > 2) return "r410";
  } finally { say("s325 finally");
  say("s412"); n++;
  B414: switch (n % 3) {
  case 0:
  try {
  say("s416"); n++;
  } catch (e) { say("s415 caught " + (e as Error).message);
  say("s417"); n++;
  say("s418"); n++;
  say("s419"); n++;
  say("s420"); n++;
  }
  try {
  say("s422"); n++;
  } catch (e) { say("s421 caught " + (e as Error).message);
  }
  say("s423"); n++;
  B425: switch (n % 3) {
  case 0:
  say("s426"); n++;
  say("s427"); n++;
  say("s428"); n++;
  say("s429"); n++;
  case 1:
  say("s430"); n++;
  say("s431"); n++;
  
  default:
  say("s432"); n++;
  say("s433"); n++;
  say("s434"); n++;
  say("s435"); n++;
  }
  case 1:
  if (n % 2) {
  say("s437"); n++;
  say("s438"); n++;
  say("s439"); n++;
  } else {
  say("s440"); n++;
  say("s441"); n++;
  say("s442"); n++;
  say("s443"); n++;
  }
  B445: {
  say("s446"); n++;
  say("s447"); n++;
  }
  B449: {
  say("s450"); n++;
  say("s451"); n++;
  }
  { let i454 = 0;
  L453: while (i454++ < 1) {
  say("s455"); n++;
  say("s456"); n++;
  say("s457"); n++;
  say("s458"); n++;
  }
  }
  break;
  default:
  L460: for (const i461 of [1, 2, 3]) {
  say("s462"); n++;
  say("s463"); n++;
  }
  if (true) break B414;
  B468: {
  say("s469"); n++;
  say("s470"); n++;
  }
  if (k % 3 === 1) throw new Error("e473");
  }
  }
  return "end" + n;
}
function f5(k: number): string {
  let n = 0;
  B475: {
  L477: for (let i478 = 0; i478 < 3; i478++) {
  say("s479"); n++;
  if (n % 2) {
  say("s481"); n++;
  say("s482"); n++;
  say("s483"); n++;
  say("s484"); n++;
  } else {
  say("s485"); n++;
  say("s486"); n++;
  say("s487"); n++;
  }
  }
  L489: for (const i490 of gen("s488", 1)) {
  try {
  say("s492"); n++;
  say("s493"); n++;
  } catch (e) { say("s491 caught " + (e as Error).message);
  say("s494"); n++;
  say("s495"); n++;
  }
  }
  try {
  L498: for (let i499 = 0; i499 < 3; i499++) {
  say("s500"); n++;
  }
  if (n > 2) break B475;
  try {
  say("s505"); n++;
  } catch (e) { say("s504 caught " + (e as Error).message);
  say("s506"); n++;
  }
  say("s507"); n++;
  } catch (e) { say("s496 caught " + (e as Error).message);
  B509: switch (n % 3) {
  case 0:
  say("s510"); n++;
  say("s511"); n++;
  case 1:
  say("s512"); n++;
  say("s513"); n++;
  
  default:
  say("s514"); n++;
  say("s515"); n++;
  say("s516"); n++;
  say("s517"); n++;
  }
  if (true) throw new Error("e520");
  L522: for (const i523 of [1, 2, 3]) {
  say("s524"); n++;
  say("s525"); n++;
  }
  B527: switch (n % 3) {
  case 0:
  say("s528"); n++;
  say("s529"); n++;
  case 1:
  say("s530"); n++;
  say("s531"); n++;
  say("s532"); n++;
  break;
  default:
  say("s533"); n++;
  say("s534"); n++;
  }
  } finally { say("s496 finally");
  say("s535"); n++;
  say("s536"); n++;
  }
  }
  try {
  say("s538"); n++;
  } catch (e) { say("s537 caught " + (e as Error).message);
  }
  if (n === 1) return "r540";
  return "end" + n;
}
function f6(k: number): string {
  let n = 0;
  { let i544 = 0;
  L543: while (i544++ < 1) {
  try {
  if (n % 2) {
  say("s547"); n++;
  say("s548"); n++;
  say("s549"); n++;
  } else {
  say("s550"); n++;
  say("s551"); n++;
  }
  say("s552"); n++;
  try {
  say("s554"); n++;
  } catch (e) { say("s553 caught " + (e as Error).message);
  say("s555"); n++;
  }
  try {
  say("s557"); n++;
  say("s558"); n++;
  say("s559"); n++;
  say("s560"); n++;
  } catch (e) { say("s556 caught " + (e as Error).message);
  say("s561"); n++;
  }
  } catch (e) { say("s545 caught " + (e as Error).message);
  }
  if (k === 0) continue L543;
  if (n === 1) throw new Error("e567");
  }
  }
  return "end" + n;
}
function f7(k: number): string {
  let n = 0;
  if (n % 2) {
  B570: switch (n % 3) {
  case 0:
  say("s571"); n++;
  L573: for (const i574 in { a: 1, b: 2 }) {
  say("s575"); n++;
  say("s576"); n++;
  }
  say("s577"); n++;
  try {
  say("s579"); n++;
  say("s580"); n++;
  } catch (e) { say("s578 caught " + (e as Error).message);
  } finally { say("s578 finally");
  }
  case 1:
  try {
  say("s582"); n++;
  } catch (e) { say("s581 caught " + (e as Error).message);
  } finally { say("s581 finally");
  say("s583"); n++;
  say("s584"); n++;
  say("s585"); n++;
  }
  say("s586"); n++;
  say("s587"); n++;
  say("s588"); n++;
  
  default:
  say("s589"); n++;
  }
  if (k > 1) throw new Error("e592");
  B594: {
  try {
  say("s596"); n++;
  say("s597"); n++;
  say("s598"); n++;
  say("s599"); n++;
  } catch (e) { say("s595 caught " + (e as Error).message);
  say("s600"); n++;
  say("s601"); n++;
  say("s602"); n++;
  say("s603"); n++;
  } finally { say("s595 finally");
  }
  try {
  say("s605"); n++;
  say("s606"); n++;
  } catch (e) { say("s604 caught " + (e as Error).message);
  } finally { say("s604 finally");
  say("s607"); n++;
  }
  if (n % 2) {
  say("s609"); n++;
  } else {
  say("s610"); n++;
  say("s611"); n++;
  say("s612"); n++;
  }
  }
  L614: for (const i615 of [1, 2, 3]) {
  if (n > 2) return "r617";
  B620: {
  say("s621"); n++;
  say("s622"); n++;
  say("s623"); n++;
  say("s624"); n++;
  }
  }
  } else {
  B626: {
  if (n === 1) throw new Error("e629");
  say("s630"); n++;
  }
  }
  if (k > 1) throw new Error("e633");
  say("s634"); n++;
  return "end" + n;
}
function rows(): void {
  let box = new Box();
  say("g0 " + attempt(() => { function* f(): Generator<number, number, number> { const a = yield 1; const b = yield a + 1; return a + b; } const g = f(); return [g.next(5).value, g.next(10).value, g.next(20).value]; }));
  say("o1 " + attempt(() => { const { 0: first, 1: second }: any = [10, 20]; return [(typeof first === "object" && first ? JSON.stringify(first) : num(first)), (typeof second === "object" && second ? JSON.stringify(second) : num(second))].join("/"); }));
  say("p2 " + attempt(() => { const [a]: any = counter("c", 0); return [num(a)].join("/"); }));
  say("o3 " + attempt(() => { const { a = t("da", 10), b = t("db", 20) }: any = { get a() { say("get a"); return 1; }, get b() { say("get b"); return undefined; }, c: null }; return [(typeof a === "object" && a ? JSON.stringify(a) : num(a)), (typeof b === "object" && b ? JSON.stringify(b) : num(b))].join("/"); }));
  box = new Box(); say("x4 " + attempt(() => t("b", box)[t("name", "v") as "v"] *= t("rhs", 4)) + " " + box.v + "," + box.w + "," + box.list.join("_") + "," + (box.inner !== null));
  say("o5 " + attempt(() => { const { a: { c } = { c: t("dc", 7) } }: any = "str"; return ["none"].join("/"); }));
  say("o6 " + attempt(() => { const { a, b }: any = { a: 1, b: 2, c: 3 }; return [(typeof a === "object" && a ? JSON.stringify(a) : num(a)), (typeof b === "object" && b ? JSON.stringify(b) : num(b))].join("/"); }));
  box = new Box(); say("x7 " + attempt(() => t("b", box).inner?.inner?.v ?? t("dflt", -1)) + " " + box.v + "," + box.w + "," + box.list.join("_") + "," + (box.inner !== null));
  box = new Box(); say("x8 " + attempt(() => t("b", box).inner?.list[t("skipped", 0)]) + " " + box.v + "," + box.w + "," + box.list.join("_") + "," + (box.inner !== null));
  box = new Box(); say("x9 " + attempt(() => delete (t("o", { a: 1 }) as any)[t("key", "a")]) + " " + box.v + "," + box.w + "," + box.list.join("_") + "," + (box.inner !== null));
  say("g10 " + attempt(() => { const g = gen("g", 1); return [g[Symbol.iterator]() === g, typeof g.next, Object.prototype.toString.call(g)]; }));
  say("p11 " + attempt(() => { const [a, b = a]: any = [1, 2, 3, 4]; return [num(a), num(b)].join("/"); }));
  box = new Box(); say("x12 " + attempt(() => ({ a: t("a", 1), [t("key", "k")]: t("v", 2), ...t("s", { z: 3 }) }).k) + " " + box.v + "," + box.w + "," + box.list.join("_") + "," + (box.inner !== null));
  say("o13 " + attempt(() => { const { a: { c } = { c: t("dc", 7) } }: any = { a: 1, b: 2, c: 3 }; return ["none"].join("/"); }));
  say("c14 " + attempt(() => { const fs: (() => number)[] = []; try { for (let i = 0; ; i++) { fs.push(() => i); if (i === 2) throw new Error("x"); } } catch { } return fs.map(f => f()); }));
  say("g15 " + attempt(() => { const g = gen("g", 2); return [Math.max(...g), g.next().done]; }));
  box = new Box(); say("x16 " + attempt(() => t("b", box).list[t("i", 0)]++) + " " + box.v + "," + box.w + "," + box.list.join("_") + "," + (box.inner !== null));
  box = new Box(); say("x17 " + attempt(() => t("base", 2) ** t("exp", 3) ** t("exp2", 2)) + " " + box.v + "," + box.w + "," + box.list.join("_") + "," + (box.inner !== null));
  box = new Box(); say("x18 " + attempt(() => t("b", box).g += t("rhs", 3)) + " " + box.v + "," + box.w + "," + box.list.join("_") + "," + (box.inner !== null));
  say("o19 " + attempt(() => { const { a, ...rest }: any = { a: 1, b: 2, c: 3 }; return [(typeof a === "object" && a ? JSON.stringify(a) : num(a)), (typeof rest === "object" && rest ? JSON.stringify(rest) : num(rest))].join("/"); }));
  say("o20 " + attempt(() => { const { [t("key", "a")]: x, b }: any = { get a() { say("get a"); return 1; }, get b() { say("get b"); return undefined; }, c: null }; return [(typeof b === "object" && b ? JSON.stringify(b) : num(b)), (typeof x === "object" && x ? JSON.stringify(x) : num(x))].join("/"); }));
  box = new Box(); say("x21 " + attempt(() => [t("a", 1), t("b2", 2), ...t("c", [3, 4]), t("d", 5)]) + " " + box.v + "," + box.w + "," + box.list.join("_") + "," + (box.inner !== null));
  box = new Box(); say("x22 " + attempt(() => typeof t("x", box).m) + " " + box.v + "," + box.w + "," + box.list.join("_") + "," + (box.inner !== null));
  say("o23 " + attempt(() => { const { b: { c } = { c: t("dc", 7) } }: any = box; return ["none"].join("/"); }));
  say("g24 " + attempt(() => { function* f(): Generator<number> { yield* [1, 2]; yield* "ab" as any; yield* counter("c", 2); } return [...f()]; }));
  box = new Box(); say("x25 " + attempt(() => t("base", 2) ** t("exp", 3) ** t("exp2", 2)) + " " + box.v + "," + box.w + "," + box.list.join("_") + "," + (box.inner !== null));
  box = new Box(); say("x26 " + attempt(() => t("b", box).list[t("b", box).v] = t("b", box).list[t("j", 0)] + t("k", 1)) + " " + box.v + "," + box.w + "," + box.list.join("_") + "," + (box.inner !== null));
  box = new Box(); say("x27 " + attempt(() => t("b", box).list[t("b", box).v] = t("b", box).list[t("j", 0)] + t("k", 1)) + " " + box.v + "," + box.w + "," + box.list.join("_") + "," + (box.inner !== null));
  say("p28 " + attempt(() => { const [...rest]: any = counter("c", 0); return [num(rest)].join("/"); }));
  box = new Box(); say("x29 " + attempt(() => t("b", box).inner?.m(t("skipped", 1))) + " " + box.v + "," + box.w + "," + box.list.join("_") + "," + (box.inner !== null));
  say("p30 " + attempt(() => { const [...rest]: any = [undefined, null, 0]; return [num(rest)].join("/"); }));
  say("p31 " + attempt(() => { const [a]: any = [1, 2, 3, 4]; return [num(a)].join("/"); }));
  say("p32 " + attempt(() => { const [a = t("da", 1), ...rest]: any = counter("c", 0); return [num(a), num(rest)].join("/"); }));
  say("c33 " + attempt(() => { const fs: (() => number)[] = []; switch (1 as number) { case 1: { let z = 5; fs.push(() => z++); } case 2: { let z = 50; fs.push(() => z++); } } return fs.map(f => f() + f()); }));
  box = new Box(); say("x34 " + attempt(() => t("b", box).list.length = t("len", 1)) + " " + box.v + "," + box.w + "," + box.list.join("_") + "," + (box.inner !== null));
  say("g35 " + attempt(() => { const g = gen("g", 3); return [g.next(), g.next("x"), g.return("early"), g.next()].map(x => num(x.value) + x.done); }));
  box = new Box(); say("x36 " + attempt(() => t("b", box).inner?.list[t("skipped", 0)]) + " " + box.v + "," + box.w + "," + box.list.join("_") + "," + (box.inner !== null));
  say("o37 " + attempt(() => { const { a: x = t("dx", 1), c: y = t("dy", 2) }: any = { }; return [(typeof x === "object" && x ? JSON.stringify(x) : num(x)), (typeof y === "object" && y ? JSON.stringify(y) : num(y))].join("/"); }));
  box = new Box(); say("x38 " + attempt(() => delete (t("o", { a: 1 }) as any)[t("key", "a")]) + " " + box.v + "," + box.w + "," + box.list.join("_") + "," + (box.inner !== null));
  box = new Box(); say("x39 " + attempt(() => t("b", box).list[t("i", 1)] += t("rhs", 5)) + " " + box.v + "," + box.w + "," + box.list.join("_") + "," + (box.inner !== null));
}
say("f0 " + attempt(() => f0(0)));
say("f0 " + attempt(() => f0(1)));
say("f0 " + attempt(() => f0(2)));
say("f0 " + attempt(() => f0(3)));
say("f1 " + attempt(() => f1(0)));
say("f1 " + attempt(() => f1(1)));
say("f1 " + attempt(() => f1(2)));
say("f1 " + attempt(() => f1(3)));
say("f2 " + attempt(() => f2(0)));
say("f2 " + attempt(() => f2(1)));
say("f2 " + attempt(() => f2(2)));
say("f2 " + attempt(() => f2(3)));
say("f3 " + attempt(() => f3(0)));
say("f3 " + attempt(() => f3(1)));
say("f3 " + attempt(() => f3(2)));
say("f3 " + attempt(() => f3(3)));
say("f4 " + attempt(() => f4(0)));
say("f4 " + attempt(() => f4(1)));
say("f4 " + attempt(() => f4(2)));
say("f4 " + attempt(() => f4(3)));
say("f5 " + attempt(() => f5(0)));
say("f5 " + attempt(() => f5(1)));
say("f5 " + attempt(() => f5(2)));
say("f5 " + attempt(() => f5(3)));
say("f6 " + attempt(() => f6(0)));
say("f6 " + attempt(() => f6(1)));
say("f6 " + attempt(() => f6(2)));
say("f6 " + attempt(() => f6(3)));
say("f7 " + attempt(() => f7(0)));
say("f7 " + attempt(() => f7(1)));
say("f7 " + attempt(() => f7(2)));
say("f7 " + attempt(() => f7(3)));
rows(); rows();
console.log(log.join("\n"));

// GENERATED: say counter tag Box [Symbol.iterator] return
// CHECK-LABEL: function {{*}}name="say"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="log"
// CHECK-NEXT: v3 = PropGet v2 key="push"
// CHECK-NEXT: v4 = Call v3, v2, v0 calleeKey="push" calleeName="log.push"
// CHECK-NEXT: v5 = Convert v4 declared={type=number site=[[w_3]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v6 = Undefined
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="counter"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_4]] flags=[OmitsNull, OmitsUndefined]}, {type=number site=[[w_5]]}, {type=undefined|number site=[[w_6]]}] results=[{type=undefined|null|[[L_7]]|Array site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: number, v2: undefined|number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = NewObject layout=[[L_9]]
// CHECK-NEXT: v4 = TypeTest v2 testedType=undefined
// CHECK-NEXT: Branch v4 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v5):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v6 = Integer integer=-1
// CHECK-NEXT: v7 = Convert v6 declared={type=number site=[[w_6]]}
// CHECK-NEXT: Jump -> next b5(v7)
// CHECK-NEXT: b4(v8):
// CHECK-NEXT: Jump -> next b5(v8)
// CHECK-NEXT: b5(v9):
// CHECK-NEXT: v10 = Integer
// CHECK-NEXT: v11 = Convert v10 declared={type=number}
// CHECK-NEXT: v12 = NewClosure v3, v0, v1, v9 function=[[f_10]]
// CHECK-NEXT: v13 = NewObject -, v11 layout=[[L_7]] fields=[0]
// CHECK-NEXT: PropDefine v13, v12 key=@@iterator
// CHECK-NEXT: v15 = FinishObject v13
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|[[L_7]] site=[[w_11]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: PutEnvironmentField v3, v16 layout=[[L_9]]
// CHECK-NEXT: v18 = Convert v16 declared={type=undefined|null|[[L_7]]|Array site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v18
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="tag"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasRestParameter, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}, {type=Array flags=[IsFromCompiler]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = NewRuntimeError runtimeError=LeftOutOfExecutable name="tag"
// CHECK-NEXT: Throw v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Box"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_12]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_12]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_12]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_13]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="[Symbol.iterator]"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, IsNamedByComputedKey] captures=[{type=env [[L_9]] flags=[IsFromCompiler]}, {type=undefined|null|string site=[[w_4]] flags=[OmitsNull, OmitsUndefined]}, {type=number site=[[w_5]]}, {type=number site=[[w_6]]}] thisType={type=anything} results=[{type=undefined|null|Generator<number> flags=[IsExpected, OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: env [[L_9]], v1: undefined|null|string, v2: number, v3: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v4 = NewObject layout=[[L_14]]
// CHECK-NEXT: v5 = Integer
// CHECK-NEXT: v6 = Convert v5 declared={type=number site=[[w_15]]}
// CHECK-NEXT: PutEnvironmentField v4, v6 layout=[[L_14]]
// CHECK-NEXT: v8 = NewClosure v4, v1, v2, v3 function=[[f_16]]
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|[[f_17]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v10 = NewClosure v0, v1 function=[[f_18]]
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|[[f_19]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v12 = NewObject -, v9, v11 layout=[[L_20]] fields=[0, 1]
// CHECK-NEXT: v13 = FinishObject v12
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|Generator<number> flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v14
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="return"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] length=1 captures=[{type=env [[L_9]] flags=[IsFromCompiler]}, {type=undefined|null|string site=[[w_4]] flags=[OmitsNull, OmitsUndefined]}] thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|[[L_21]] flags=[IsExpected]}] functionTypes={{*}}[[f_19]]] {
// CHECK-NEXT: b0(v0: env [[L_9]], v1: undefined|null|string, v2: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_22]]
// CHECK-NEXT: v4 = String string=".return"
// CHECK-NEXT: v5 = Add v1, v4
// CHECK-NEXT: v6 = Call v3, -, v5 calleeName="say"
// CHECK-NEXT: v7 = GetEnvironmentField v0 layout=[[L_9]]
// CHECK-NEXT: v8 = CheckInitialized v7 name="self"
// CHECK-NEXT: v9 = PropGet v8 key="closed"
// CHECK-NEXT: v10 = Increment v9
// CHECK-NEXT: v11 = Convert v10 declared={type=number site=[[w_23]]}
// CHECK-NEXT: PropSet v8, v11 key="closed"
// CHECK-NEXT: v13 = Boolean boolean=true
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|boolean}
// CHECK-NEXT: v15 = NewObject -, v2, v14 layout=[[L_21]] fields=[1, 0]
// CHECK-NEXT: v16 = FinishObject v15
// CHECK-NEXT: v17 = Convert v16 declared={type=undefined|null|[[L_21]] flags=[IsExpected]}
// CHECK-NEXT: Return v17
// CHECK-NEXT: }
