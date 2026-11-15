// answers: without-library
// # Outside loops ONE operation opens a guess at what is written where its closed form is a lookup or a row of tests and its typed form a load or a compare:
// # `.length` off a written text, the truth of a written list and of a written number. Whatever else lies in the field does what the language says, in the closed arm.
// # f1 = lengthOfText, f2 = lengthOfList, f3 = hasList, f4 = hasCount, f5 = tell, f6 = ask
// # RUN(FORM): walk f1 f3 f4 mechanisms=all
// # FORM-LABEL: code f1:Body
// # FORM: = TypeTest {{*}}testedType=string
// # FORM: = GetStringLength
// # FORM: = PropGet {{*}}key="length"
// # FORM-LABEL: code f3:Body
// # FORM: = TypeTest {{*}}testedType=Array
// # FORM: = ToBoolean {{*}}form=Generic
// # FORM-LABEL: code f4:Body
// # FORM: = TypeTest {{*}}testedType=number
// # FORM: = ToBoolean {{*}}form=Numbers
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 53 of 53 of 53
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
interface Holder { text?: string; list?: number[]; count?: number; }
function lengthOfText(holder: Holder): number { return holder.text!.length; }
function lengthOfList(holder: Holder): number { return holder.list!.length; }
function hasList(holder: Holder): number { return holder.list ? 1 : 2; }
function hasCount(holder: Holder): number { return holder.count ? 1 : 2; }
function tell(f: () => unknown) { try { const answer = f(); report(typeof answer + " " + String(answer)); } catch (e) { report((e as Error).name); } }
const holders: unknown[] = [{ text: "four", list: [1, 2, 3], count: 4 }, { text: "", list: [], count: 0 }, { text: "a" + "b".repeat(3), list: [1.5], count: -1 }, { text: 5, list: 6, count: "7" }, { text: { length: 8 }, list: { length: 9 }, count: {} }, { text: [1], list: "ab", count: "" }, { text: null, list: null, count: null }, { text: true, list: false, count: true }, { text: 1n, list: 0n, count: 0n }, { text: Symbol.iterator, list: Symbol.iterator, count: Symbol.iterator }, { text: () => 1, list: (a: unknown, b: unknown) => 2, count: NaN }, { count: 0.5, list: -0, text: new String("abc") }, {}];
function ask(holder: Holder) { tell(() => lengthOfText(holder)); tell(() => lengthOfList(holder)); tell(() => hasList(holder)); tell(() => hasCount(holder)); }
for (let i = 0; i < holders.length; i++) ask(holders[i] as Holder);
report("end");
