const said: string[] = []; function report(value: unknown) { said.push(String(value)); }
class Signals {
  #handlers: { [name: string]: ((x: number) => void)[] | undefined } = {};
  on(name: string, handler: (x: number) => void) { (this.#handlers[name] ??= []).push(handler); return this; }
  lay(name: string, what: unknown) { this.#handlers[name] = what as never; }
  emit(name: string, x: number) { const list = this.#handlers[name]; if (!list) return 0; for (const handler of list) handler(x); return list.length; }
}
let sum = 0;
const names = ["open", "data", "close", "none", "set", "text", "act", "number", "own", "grows", "holes"];
const signals = new Signals();
signals.on(names[0]!, x => { sum += x; }).on(names[1]!, x => { sum += 2 * x; }).on(names[1]!, x => { sum -= x; });
function tell(f: () => unknown) { try { report(f()); } catch (e) { report((e as Error).name + ": " + (e as Error).message); } }
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
console.log(said.join("\n"));
