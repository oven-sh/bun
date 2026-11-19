// answers: with-library
// # if (kind === "alpha") ..: where the operands are a string and a value, or two strings, the comparison made a boolean: two blocks, a phi, and a branch on the phi, which the threading of jumps then took apart again,
// # three blocks a site built and emptied. The generic form branched on the comparison itself already. Now these two do: what the branch leads to is handed to the comparison.
// # RUN(VALUE): emit f1
// # REQUIRES(VALUE): as-written
// # VALUE-NOT: = Phi
// # VALUE: without position:
// # RUN(NULLABLE): emit f2
// # REQUIRES(NULLABLE): as-written
// # NULLABLE-NOT: = Phi
// # NULLABLE: without position:
// # RUN(TEXT): emit f4
// # REQUIRES(TEXT): as-written
// # TEXT-NOT: = Phi
// # TEXT: without position:
// # RUN(CHAIN): emit f5
// # REQUIRES(CHAIN): as-written
// # CHAIN-NOT: = Phi
// # CHAIN: without position:
// # RUN(KEPT): emit f8
// # REQUIRES(KEPT): as-written
// # KEPT: = Phi
// # Texts that are empty, short, compared in place and compared by a stub, against equal and unequal texts, the same length and another, ropes, texts of 16 bits, and what is no text; === and !==, chains of || and &&,
// # in loops and as a value (which still makes its boolean).
// # RUN: run-in-shell $SHELL
// # CHECK: 40 of 40 of 40
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;

const outside = JSON.parse('["alpha","beta","gamma","delta","alphb","alph","alphaa","","a","\\u03b1lpha","a text that is long enough to be compared by the stub and not in place, surely",7,null,true,{"alpha":1},["alpha"]]');
function ofValue(kind: unknown) { if (kind === "alpha") return 1; if (kind === "beta") return 2; if (kind === "") return 3; if (kind === "a text that is long enough to be compared by the stub and not in place, surely") return 4; return 0; }
function ofText(kind: string) { if (kind === "alpha") return 1; if (kind === "beta") return 2; if (kind === "") return 3; if (kind === "a text that is long enough to be compared by the stub and not in place, surely") return 4; return 0; }
function isNotValue(kind: unknown) { if (kind !== "gamma") return "other"; return "gamma"; }
function isNotText(kind: string) { if (kind !== "gamma") return "other"; return "gamma"; }
function eitherOfValue(kind: unknown) { if (kind === "alpha" || kind === "delta" || kind === "a") return "one of three"; return "none"; }
function eitherOfText(kind: string) { if (kind === "alpha" || kind === "delta" || kind === "a") return "one of three"; return "none"; }
function bothOfValues(first: unknown, second: unknown) { if (first === "alpha" && second === "beta") return "both"; return "not both"; }
function asValue(kind: unknown) { return kind === "alpha"; }
function asValueOfText(kind: string) { const is = kind === "alpha"; return [is, !is]; }
function countsIn(list: unknown[]) { let n = 0; for (let i = 0; i < list.length; i++) { if (list[i] === "alpha") n++; else if (list[i] !== "beta") n += 100; } return n; }
function whileNot(list: unknown[]) { let i = 0; while (list[i] !== "delta") i++; return i; }
function chooses(kind: unknown) { return kind === "beta" ? "yes" : "no"; }
for (const kind of outside) report([ofValue(kind), isNotValue(kind), eitherOfValue(kind), asValue(kind), chooses(kind), bothOfValues(kind, "beta"), bothOfValues("alpha", kind)].join());
for (const kind of outside) if (typeof kind === "string") report([ofText(kind), isNotText(kind), eitherOfText(kind), asValueOfText(kind)].join());
const ropes = [outside[5] + "a", "al" + outside[0].slice(2), outside[8] + "lpha", outside[1].slice(0, 2) + "ta", "gam" + "ma".slice(0), outside[5] + outside[9].slice(0, 1), String(outside[7]) + ""];
for (const rope of ropes) report([ofValue(rope), ofText(rope), isNotValue(rope), isNotText(rope), eitherOfValue(rope), eitherOfText(rope), asValue(rope)].join());
report(countsIn(outside)); report(whileNot(outside)); report(countsIn(ropes)); report(countsIn([]));
let total = 0;
for (let turn = 0; turn < 20000; turn++) total += ofValue(outside[turn & 15]) + ofText(ropes[turn % 7]) + countsIn(ropes);
report(total);
report("end");
