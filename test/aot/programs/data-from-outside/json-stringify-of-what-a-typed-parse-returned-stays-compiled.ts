// A type that the program only ever gets from `JSON.parse(text) as T` is written by the code compiled for it: its keys are expected in the order of the declaration.
declare const aotRuntimeCounters: undefined | (() => string);
declare const aotOperationCount: undefined | ((name: string) => number);
interface Inner { x: number; label: string }
interface Flat { id: number; name: string; paid: boolean; price: number }
interface Nested { id: number; inner: Inner }
interface Circle { kind: "circle"; radius: number }
interface Square { kind: "square"; side: number }
interface Drawn { id: number; shape: Circle | Square }
interface Noted { id: number; note?: string }
const counted = typeof aotOperationCount === "function" ? aotOperationCount : null;
// The texts that JSON.stringify left to the engine's own writer, and the values that compiled code handed to the run time.
const leftToTheEngine = () => (counted ? Number(/(\d+)\tcounter:JSONStringifySlowPaths/.exec(aotRuntimeCounters!())?.[1] ?? 0) + counted("operationAOTJSONAppendValue") + counted("operationAOTStringBuilderAppendJSON") : 0);
function measure(label: string, run: () => string, isCompiled: boolean): void {
  for (let i = 0; i < 10; i++) run();
  const before = leftToTheEngine();
  let written = "";
  for (let i = 0; i < 100; i++) written = run();
  console.log(label + ": " + written, leftToTheEngine() - before === (counted && !isCompiled ? 100 : 0));
}
const flat = JSON.parse('{"id":1,"name":"n","paid":true,"price":1.5}') as Flat;
measure("declared order", () => JSON.stringify(flat), true);
const nested = JSON.parse('{"id":1,"inner":{"x":2,"label":"l"}}') as Nested;
measure("an object below", () => JSON.stringify(nested), true);
const circle = JSON.parse('{"id":1,"shape":{"kind":"circle","radius":2}}') as Drawn;
measure("a union below", () => JSON.stringify(circle), true);
const noted = JSON.parse('{"id":1,"note":"n"}') as Noted;
measure("an optional member", () => JSON.stringify(noted), true);
const bare = JSON.parse('{"id":1}') as Noted;
measure("without it", () => JSON.stringify(bare), true);
const turned = JSON.parse('{"price":1.5,"paid":true,"name":"n","id":1}') as Flat;
measure("another order", () => JSON.stringify(turned), true);
const told = JSON.parse('{"id":1,"name":"n","paid":true,"price":1.5}') as Flat;
(told as any).toJSON = () => "told";
measure("toJSON of its own", () => JSON.stringify(told), false);
