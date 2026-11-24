// answers: without-library
// # a text that a function joins and returns is made as a key where a call of the function hands it to a Map or a Set as the key; a function whose texts nobody looks up by joins as before. A key is a string like any other: every answer is the same
// # f8 = tell, f1 = berthName, f2 = label, f3 = berthOf, f4 = seenBefore, f5 = show, f6 = throughVariable, f7 = nameKey
// # RUN(KEY): walk f1 mechanisms=all-Inlining
// # KEY: = Strcat {{*}}[isLikelyKey]
// # RUN(NAMED): walk f7 mechanisms=all-Inlining
// # NAMED: = Strcat {{*}}[isLikelyKey]
// # RUN(LABEL): walk f2 mechanisms=all-Inlining
// # LABEL: = Strcat
// # LABEL-NOT: isLikelyKey
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 53 of 53 of 53
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
function tell(f: () => unknown) { try { report(f()); } catch (e) { report((e as Error).name); } }
function berthName(quay: unknown, place: unknown, mark: string): string { return `${quay}.${place}${mark}`; }
function label(a: unknown, b: unknown): string { return `${a} and ${b}!`; }
const berths = new Map<string, number>();
const seen = new Set<string>();
function berthOf(quay: unknown, place: unknown, mark: string): number { const name = berthName(quay, place, mark); const held = berths.get(name); if (held === undefined) { berths.set(name, 1 + berths.size); return 0; } return held; }
function seenBefore(a: unknown, b: unknown): boolean { const id = nameKey(a, b); if (seen.has(id)) return true; seen.add(id); return false; }
function show(a: unknown, b: unknown): string { const text = label(a, b); return text + text.length; }
function throughVariable(a: unknown, b: unknown): string { const id = berthName(a, b, ":v"); return id + "|" + id.length + "|" + id.charCodeAt(0) + "|" + (id === a + "." + b + ":v"); }
function nameKey(a: unknown, b: unknown): string { return a + "/" + b; }
tell(() => berthOf(1, 2, ""));
tell(() => berthOf(1, 2, ""));
tell(() => berthOf(12, "", ""));
tell(() => berthOf(1, "2", ""));
tell(() => berthOf("1.2", "", ""));
tell(() => berthOf("1", "2.", ""));
tell(() => berthOf(1, 2, ":1"));
tell(() => berthOf(1, 2, ":1"));
tell(() => berthOf(-0, 0, ""));
tell(() => berthOf(0, 0, ""));
tell(() => berthOf(NaN, 1.5, ""));
tell(() => berthOf(NaN, 1.5, ""));
tell(() => berthOf(1e21, 1e-7, ""));
tell(() => berthOf(undefined, null, ""));
tell(() => berthOf("undefined", "null", ""));
tell(() => berthOf(true, false, ""));
tell(() => berthOf("é", "中", ""));
tell(() => berthOf("é", "中", ""));
tell(() => berthOf("\ud83d", "\ude00", ""));
tell(() => berthOf("", "", ""));
tell(() => berthOf("", "", ""));
tell(() => berthOf("x".repeat(300), "y".repeat(300), ""));
tell(() => berthOf("x".repeat(300), "y".repeat(300), ""));
tell(() => berthOf(10n, 20n, ""));
let order = "";
tell(() => berthOf({ toString() { order += "a"; return "A"; } }, { toString() { order += "b"; return "B"; } }, ""));
tell(() => berthOf("A", "B", ""));
tell(() => order);
tell(() => berthOf(Symbol("s"), 1, ""));
tell(() => berthOf({ toString() { throw new RangeError("no"); } }, 1, ""));
tell(() => berths.size);
tell(() => berths.has("1.2"));
tell(() => berths.get("1.2:1"));
tell(() => berths.delete(berthName(1, 2, "")));
tell(() => berths.has("1.2"));
tell(() => berthOf(1, 2, ""));
tell(() => seenBefore("a", "b"));
tell(() => seenBefore("a", "b"));
tell(() => seenBefore("a/", "b"));
tell(() => seenBefore("a", "/b"));
tell(() => seenBefore(1, 2));
tell(() => seenBefore("1", "2"));
tell(() => seen.size);
tell(() => show(1, 2));
tell(() => show("x", {}));
tell(() => throughVariable(1, 2));
tell(() => throughVariable("中", 2));
const bag: Record<string, number> = {};
tell(() => { bag[berthName(1, 2, "")] = 5; return bag["1.2"]; });
tell(() => berthName(1, 2, "") === berthName(1, 2, ""));
tell(() => Object.is(berthName(1, 2, ""), "1.2"));
tell(() => typeof berthName(1, 2, ""));
tell(() => berthName(1, 2, "").split(".").length);
tell(() => berthName(1, 2, "") + berthName(3, 4, ""));
report("end");
