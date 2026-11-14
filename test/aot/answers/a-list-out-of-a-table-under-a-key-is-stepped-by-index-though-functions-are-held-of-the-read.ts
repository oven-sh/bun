// answers: with-library
// # `for (const handler of this.handlers[name])`: of the read under a key that nobody knows Link holds the function that lies in a field of the record itself. A function is not iterated: that word says nothing of what the loop steps through, so the value is asked whether it is a list and then read by index; a set, a text, an object with steps of its own, a function, a number, a list that grows and one with a hole answer as plain.
// # f5 = emit, v5 = the read
// # RUN(HELD): link held accesses mechanisms=all
// # HELD: read f5 v5 proven={{*}}|f{{*}}
// # RUN(FORM): walk f5 mechanisms=all
// # FORM-LABEL: code f5:Body
// # FORM: = ElemGet
// # FORM: = TypeTest {{*}} testedType=Array
// # FORM: = GetArrayElement
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 20 of 20 of 20
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
class Signals { #handlers: { [name: string]: ((x: number) => void)[] | undefined } = { act: (() => 1) as never }; on(name: string, handler: (x: number) => void) { (this.#handlers[name] ??= []).push(handler); return this; } lay(name: string, what: unknown) { this.#handlers[name] = what as never; } emit(name: string, x: number) { const list = this.#handlers[name]; if (!list) return 0; for (const handler of list) handler(x); return list.length; } }
let sum = 0;
const names = ["open", "data", "close", "none", "set", "text", "act", "number", "own", "grows", "holes"];
const signals = new Signals();
signals.on(names[0]!, x => { sum += x; }).on(names[1]!, x => { sum += 2 * x; }).on(names[1]!, x => { sum -= x; });
function tell(f: () => unknown) { try { report(f()); } catch (e) { report((e as Error).name); } }
for (let turn = 0; turn < 3; turn++) for (let i = 0; i < 4; i++) tell(() => signals.emit(names[i]!, turn + 1) + " " + sum);
signals.lay(names[4]!, new Set([(x: number) => { sum += 100 * x; }]));
signals.lay(names[5]!, "ab");
signals.lay(names[6]!, () => 1);
signals.lay(names[7]!, 7);
signals.lay(names[8]!, { *[Symbol.iterator]() { yield (x: number) => { sum += 1000 * x; }; }, length: "own" });
const grows: ((x: number) => void)[] = [() => { if (grows.length < 4) grows.push(y => { sum += 7 * y; }); }];
signals.lay(names[9]!, grows);
signals.lay(names[10]!, [, (x: number) => { sum += x; }]);
for (let i = 4; i < names.length; i++) tell(() => signals.emit(names[i]!, 1) + " " + sum);
report("end");
