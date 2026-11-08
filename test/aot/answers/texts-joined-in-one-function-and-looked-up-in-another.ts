// answers: without-library
// # a text that a function joins and returns is made as a key where a call of the function hands it to a Map or a Set as the key; a function whose texts nobody looks up by joins as before. A key is a string like any other: every answer is the same
// # f8 = tell, f1 = pairKey, f2 = label, f3 = related, f4 = seenBefore, f5 = show, f6 = throughVariable, f7 = nameKey
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
function pairKey(a: unknown, b: unknown, postFix: string): string { return `${a},${b}${postFix}`; }
function label(a: unknown, b: unknown): string { return `${a} and ${b}!`; }
const relation = new Map<string, number>();
const seen = new Set<string>();
function related(a: unknown, b: unknown, postFix: string): number { const id = pairKey(a, b, postFix); const entry = relation.get(id); if (entry !== undefined) return entry; relation.set(id, relation.size + 1); return 0; }
function seenBefore(a: unknown, b: unknown): boolean { const id = nameKey(a, b); if (seen.has(id)) return true; seen.add(id); return false; }
function show(a: unknown, b: unknown): string { const text = label(a, b); return text + text.length; }
function throughVariable(a: unknown, b: unknown): string { const id = pairKey(a, b, ":v"); return id + "|" + id.length + "|" + id.charCodeAt(0) + "|" + (id === a + "," + b + ":v"); }
function nameKey(a: unknown, b: unknown): string { return a + "/" + b; }
tell(() => related(1, 2, ""));
tell(() => related(1, 2, ""));
tell(() => related(12, "", ""));
tell(() => related(1, "2", ""));
tell(() => related("1,2", "", ""));
tell(() => related("1", "2,", ""));
tell(() => related(1, 2, ":1"));
tell(() => related(1, 2, ":1"));
tell(() => related(-0, 0, ""));
tell(() => related(0, 0, ""));
tell(() => related(NaN, 1.5, ""));
tell(() => related(NaN, 1.5, ""));
tell(() => related(1e21, 1e-7, ""));
tell(() => related(undefined, null, ""));
tell(() => related("undefined", "null", ""));
tell(() => related(true, false, ""));
tell(() => related("é", "中", ""));
tell(() => related("é", "中", ""));
tell(() => related("\ud83d", "\ude00", ""));
tell(() => related("", "", ""));
tell(() => related("", "", ""));
tell(() => related("x".repeat(300), "y".repeat(300), ""));
tell(() => related("x".repeat(300), "y".repeat(300), ""));
tell(() => related(10n, 20n, ""));
let order = "";
tell(() => related({ toString() { order += "a"; return "A"; } }, { toString() { order += "b"; return "B"; } }, ""));
tell(() => related("A", "B", ""));
tell(() => order);
tell(() => related(Symbol("s"), 1, ""));
tell(() => related({ toString() { throw new RangeError("no"); } }, 1, ""));
tell(() => relation.size);
tell(() => relation.has("1,2"));
tell(() => relation.get("1,2:1"));
tell(() => relation.delete(pairKey(1, 2, "")));
tell(() => relation.has("1,2"));
tell(() => related(1, 2, ""));
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
tell(() => { bag[pairKey(1, 2, "")] = 5; return bag["1,2"]; });
tell(() => pairKey(1, 2, "") === pairKey(1, 2, ""));
tell(() => Object.is(pairKey(1, 2, ""), "1,2"));
tell(() => typeof pairKey(1, 2, ""));
tell(() => pairKey(1, 2, "").split(",").length);
tell(() => pairKey(1, 2, "") + pairKey(3, 4, ""));
report("end");
