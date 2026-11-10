// answers: with-library
// # `if (map.has(key)) { map.clear(); map.set("other", 9); .. map.get(key) }` in a loop: the table is emptied in place and its first entry is filled again under another key. A place kept across that would read 9 where the answer is undefined: a deleted or emptied entry reads as nothing and looks right, this one does not. Under the word that checks proofs the lookup at a kept place searches afresh and holds the kept place against what that finds.
// # f1 = kept, f2 = refilled, f3 = refilledByName
// # RUN(FORM): walk f1 f2 f3 mechanisms=all
// # FORM-LABEL: code f1:Body
// # FORM: [[place]]: {{*}} = FindKeyInMap
// # FORM: = GetValueAtPlaceInMap {{*}}, [[place]]
// # FORM-LABEL: code f2:Body
// # FORM-NOT: GetValueAtPlaceInMap
// # FORM-LABEL: code f3:Body
// # FORM-NOT: GetValueAtPlaceInMap
// # RUN(NET): walk f1 testing=CheckProofsAtRunTime mechanisms=all
// # NET-LABEL: code f1:Body
// # NET: [[first]]: {{*}} = FindKeyInMap
// # NET: [[again]]: {{*}} = FindKeyInMap
// # NET: = StrictEq [[again]], [[first]]
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 11 of 11 of 11
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
class Entry { constructor(public label: string) {} }
const keys: unknown[] = ["a", "zz", "other", 1, 2.5, null];
const labels = ["a", "zz", "other"];
const entries: Entry[] = [];
for (let i = 0; i < labels.length; i++) entries.push(new Entry(labels[i]!));
function kept() { const map = new Map<unknown, unknown>(); map.set("a", 1); map.set("other", "two"); map.set(1, null); let said = ""; for (let i = 0; i < keys.length; i++) { const key = keys[i]; if (map.has(key)) said += map.get(key) + ";"; else said += "-;"; } return said; }
function refilled() { const map = new Map<unknown, unknown>(); map.set("a", 1); let said = ""; for (let i = 0; i < keys.length; i++) { const key = keys[i]; if (map.has(key)) { map.clear(); map.set("other", 9); said += map.get(key) + ";"; } } return said; }
function refilledByName() { const map = new Map<string, number>(); map.set("a", 1); let said = ""; for (let i = 0; i < entries.length; i++) { const entry = entries[i]!; if (map.has(entry.label)) { map.clear(); map.set("other", 9); said += map.get(entry.label) + ";"; } } return said; }
function refilledWithTexts() { const map = new Map<unknown, unknown>(); map.set("a", "one"); let said = ""; for (let i = 0; i < keys.length; i++) { const key = keys[i]; if (map.has(key)) { map.clear(); map.set("other", "nine"); said += map.get(key) + ";"; } } return said; }
function refilledUnderNumbers() { const map = new Map<unknown, unknown>(); map.set(1, "one"); let said = ""; for (let i = 0; i < keys.length; i++) { const key = keys[i]; if (map.has(key)) { map.clear(); map.set(2.5, "other"); said += map.get(key) + ";"; } } return said; }
function tell(f: () => unknown) { try { report(f()); } catch (e) { report((e as Error).name); } }
for (let turn = 0; turn < 2; turn++) { tell(() => kept()); tell(() => refilled()); tell(() => refilledByName()); tell(() => refilledWithTexts()); tell(() => refilledUnderNumbers()); }
report("end");
