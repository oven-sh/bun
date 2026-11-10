// answers: without-library
// # `for (const key in table) if (asked < table[key]) ..` in a loop, where `table` is one of two records: the turns are written out once for each record, behind the tests of its shape, its order of keys
// # and that it has nothing else, as long as the turns of all arms together stay within what may be walked (f3, f4: the record of fifteen uses it up); an object of either record that is no longer as it was made, and one that a turn changes, goes by the loop as written, from the key at which it stands.
// # f1 = pickOfAny, f2 = pick, f3 = listed, f4 = changed, f5 = tell
// # RUN(FORM): walk f2 f3 f4 mechanisms=all
// # FORM-LABEL: code f2:Body
// # FORM: = HasKeyOrder {{*}}fields=[11, 12, 13, 14, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
// # FORM: = HasKeyOrder {{*}}fields=[0, 1, 2, 3]
// # FORM: = ForInStep
// # FORM-LABEL: code f3:Body
// # FORM: = HasKeyOrder {{*}}fields=[11, 12, 13, 14, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
// # FORM-LABEL: code f4:Body
// # FORM: = HasKeyOrder {{*}}fields=[11, 12, 13, 14, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 27 of 27 of 27
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
function pick(asked: number[], table: Record<string, number>) { const line: string[] = new Array(asked.length); for (let i = 0; i < asked.length; i++) { line[i] = "-"; for (const key in table) { if (asked[i] < table[key]) { line[i] = key; break; } } } return line.join(""); }
function pickOfAny(asked: number[], table: any) { const line: string[] = new Array(asked.length + 1); line[asked.length] = "any"; for (let i = 0; i < asked.length; i++) { line[i] = "-"; for (const key in table) { if (asked[i] < table[key]) { line[i] = key; break; } } } return line.join(""); }
function listed(times: number, table: Record<string, number>) { const line: string[] = new Array(40); let at = 0; let sum = 0; for (let i = 0; i < times; i++) { for (const key in table) { line[at++] = key; sum = sum * 2 + table[key]; } line[at++] = ";"; } return line.join("") + sum; }
function changed(times: number, table: Record<string, any>, change: (table: any, key: string, turn: number) => void) { const line: unknown[] = new Array(80); let at = 0; for (let i = 0; i < times; i++) { for (const key in table) { change(table, key, i); line[at++] = key; line[at++] = table[key]; } line[at++] = ";"; } return line.join(" "); }
function tell(f: () => unknown) { try { report(f()); } catch (e) { report((e as Error).name); } }
const few = (): Record<string, any> => ({ a: 0.25, c: 0.5, g: 0.75, t: 1 });
const many = (): Record<string, any> => ({ a: 0.05, c: 0.1, g: 0.15, t: 0.2, B: 0.25, D: 0.3, H: 0.4, K: 0.5, M: 0.6, N: 0.7, R: 0.8, S: 0.9, V: 0.92, W: 0.94, Y: 1 });
const asked = [0.1, 0.3, 0.6, 0.95, 2, -1, NaN];
report(pick(asked, few()));
report(pick(asked, many()));
report(listed(2, few()));
report(listed(2, many()));
const otherOrder = few();
delete otherOrder.c;
otherOrder.c = 0.5;
report(pick(asked, otherOrder));
report(listed(2, otherOrder));
const withMore = many();
withMore["more" + asked.length] = 3;
report(pick(asked, withMore));
report(listed(1, withMore));
const withElement = few();
withElement[3] = 0.01;
report(pick(asked, withElement));
report(listed(1, withElement));
const texts = few();
texts.c = "0.5";
texts.g = { valueOf() { return 0.75; } };
report(pick(asked, texts));
const frozen = many();
Object.freeze(frozen);
report(pick(asked, frozen));
const hidden = few();
Object.defineProperty(hidden, "c", { value: 0.5, enumerable: false, configurable: true });
report(pick(asked, hidden));
report(listed(1, hidden));
const below = Object.create({ up: 5 });
below.a = 0.25;
report(pickOfAny(asked, below));
tell(() => pickOfAny(asked, null));
report(pickOfAny(asked, "ab"));
report(pickOfAny(asked, [0.2, 0.7]));
report(pickOfAny(asked, few()));
report(changed(2, few(), (table, key) => { if (key === "a") delete table.g; }));
report(changed(2, few(), (table, key) => { if (key === "c") table[key + "late"] = 1; }));
report(changed(2, many(), (table, key, turn) => { if (key === "H" && !turn) { delete table.Y; delete table.a; } }));
report(changed(2, many(), (table, key) => { if (key === "D") Object.defineProperty(table, "K", { get() { return "got"; }, enumerable: true, configurable: true }); }));
report(changed(2, few(), (table, key) => { if (key === "c") Object.defineProperty(table, "g", { value: 9, enumerable: false, configurable: true }); }));
report(changed(2, few(), (table, key, turn) => { if (key === "g" && turn) table.a = "late"; }));
report(changed(1, few(), (table, key) => { table[key] += 1; }));
report("end");
