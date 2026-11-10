// answers: without-library
// # `pair.name + "." + pair.value`: the read of the second field stands between the two joins. A join of what has a text by itself can fail only for its length, and then the join that alone reads it fails too, with the same error: where nothing that anybody sees stands between them the first is taken apart and never made: one join of three parts, and in a loop the parts go straight into the builder.
// # A call, a store or a getter between them is seen: there both joins stay, and a first join that is too long fails before the getter is read and before the store is done.
// # f1 = ofFields, f2 = ofFive, f3 = tell, f4 = withStoreBetween, f5 = withGetterBetween, f6 = ofLoose, f7 = withCallBetween, f8 = readTwice, f9 = inLoop
// # RUN(ONE): walk f1 f2 f6 mechanisms=all
// # ONE-LABEL: code f1:Body
// # ONE-COUNT-1: = Strcat
// # ONE-LABEL: code f2:Body
// # ONE-COUNT-1: = Strcat
// # ONE-LABEL: code f6:Body
// # ONE-COUNT-1: = Strcat
// # RUN(NOSUM): walk f1 f2 f6 f9 mechanisms=all
// # NOSUM-NOT: form=Strings
// # NOSUM-NOT: form=StringAndPrimitive
// # RUN(STAYS): walk f7 f4 f5 mechanisms=all
// # STAYS-NOT: = Strcat
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 27 of 27 of 27
// # CHECK-NEXT: exited with 0
// # RUN(ALSO1): run-in-shell mechanisms=none $SHELL
// # ALSO1: 27 of 27 of 27
// # ALSO1-NEXT: exited with 0
declare function report(value: unknown): void;
interface Pair { name: string; value: string }
interface Loose { name: string | undefined; count: number; big: bigint; flag: boolean | null }
let log = "";
function ofFields(pair: Pair) { return pair.name + "." + pair.value; }
function ofFive(first: Pair, second: Pair) { return first.name + "=" + first.value + ";" + second.name; }
function ofLoose(loose: Loose) { return loose.name + ":" + loose.count + ":" + loose.big + ":" + loose.flag; }
function tell(text: string) { log += "<" + text + ">"; return text; }
function withCallBetween(pair: Pair) { return pair.name + "." + tell(pair.value); }
function withStoreBetween(pair: Pair, other: Pair) { const front = pair.name + "."; other.name = "stored"; return front + pair.value; }
class Counted { reads = 0; constructor(readonly name: string, private readonly held: string) {} get value() { this.reads++; log += "<read>"; return this.held; } }
function withGetterBetween(counted: Counted) { return counted.name + counted.name + counted.value; }
function readTwice(pair: Pair) { const front = pair.name + "."; return front + pair.value + front.length; }
function inLoop(pairs: Pair[]) { let out = ""; for (let at = 0; at < pairs.length; at++) { const pair = pairs[at]!; out += pair.name + "=" + pair.value + ";"; } return out; }
function failing(run: () => string) { try { return run().length; } catch (error) { return error instanceof RangeError ? "RangeError" : String(error); } }
report(ofFields({ name: "left", value: "right" }));
report(ofFields({ name: "", value: "" }));
report(ofFields({ name: "café", value: "中文" }));
report(ofFive({ name: "a", value: "b" }, { name: "c", value: "d" }));
report(ofLoose({ name: undefined, count: -0, big: 12345678901234567890n, flag: null }));
report(ofLoose({ name: "n", count: 1.5, big: -1n, flag: false }));
report(ofLoose({ name: "n", count: NaN, big: 0n, flag: true }));
report(withCallBetween({ name: "x", value: "y" }));
report(log);
const shared: Pair = { name: "before", value: "kept" };
report(withStoreBetween(shared, shared));
report(shared.name);
report(readTwice({ name: "four", value: "!" }));
report(inLoop([{ name: "a", value: "1" }, { name: "b", value: "2" }, { name: "", value: "" }]));
report(inLoop([]));
let long = "ab";
for (let turn = 0; turn < 29; turn++) long = long + long;
report(long.length);
report(failing(() => ofFields({ name: long, value: "x" })));
report(failing(() => ofFields({ name: long, value: long })));
report(failing(() => ofFive({ name: long, value: "b" }, { name: long, value: "d" })));
const counted = new Counted(long, "c");
log = "";
report(failing(() => withGetterBetween(counted)));
report(counted.reads);
report(log);
const short = new Counted("s", "c");
report(failing(() => withGetterBetween(short)));
report(short.reads);
const stored: Pair = { name: long + long.slice(1), value: "kept" };
report(stored.name.length);
const other: Pair = { name: "before", value: "" };
report(failing(() => withStoreBetween(stored, other)));
report(other.name);
report("end");
