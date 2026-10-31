// Json stringify instances of array subclasses stay compiled.
// Env: JSC_aotCountsPath=/dev/null
declare const aotRuntimeCounters: undefined | (() => string);
declare const aotOperationCount: undefined | ((name: string) => number);
const counted = typeof aotOperationCount === "function" ? aotOperationCount : null;
// The texts that JSON.stringify left to the engine's own writer, and the values that compiled code handed to the run time.
const leftToTheEngine = () => (counted ? Number(/(\d+)\tcounter:JSONStringifySlowPaths/.exec(aotRuntimeCounters!())?.[1] ?? 0) + counted("operationAOTJSONAppendValue") + counted("operationAOTStringBuilderAppendJSON") : 0);
const left: string[] = [];
interface Label { id: number; name: string }
interface Issue { id: number; title: string; labels: Label[] }
interface Holder { id: number; held: unknown }
class Rows<T> extends Array<T> {
  count = 0;
}
class Told<T> extends Array<T> {
  toJSON() {
    return this.length;
  }
}
function fill<T, L extends T[]>(list: L, ...items: T[]): L {
  for (const item of items) list.push(item);
  return list;
}
function measure(label: string, run: () => string | undefined): void {
  const before = leftToTheEngine();
  for (let i = 0; i < 10; i++) run();
  let length = 0;
  for (let i = 0; i < 100; i++) length += run()!.length;
  if (leftToTheEngine() !== before) left.push(label);
  console.log(label + ": " + length + " characters");
}
const label = (id: number): Label => ({ id, name: "label " + id });
const inARecord: Issue = { id: 1, title: "one", labels: fill(new Rows<Label>(), label(1), label(2)) };
measure("an instance in a record", () => JSON.stringify(inARecord));
const alone = fill(new Rows<Label>(), label(3), label(4));
measure("an instance alone", () => JSON.stringify(alone));
const unknownMember: Holder = { id: 2, held: fill(new Rows<Label>(), label(5)) };
measure("an instance as a member of unknown type", () => JSON.stringify(unknownMember));
const plainObjects: Holder = { id: 3, held: fill(new Rows<unknown>(), JSON.parse('{"a":1}'), JSON.parse('{"b":"two"}')) };
measure("an instance that holds objects without a type", () => JSON.stringify(plainObjects));
const told: Issue = { id: 4, title: "four", labels: fill(new Told<Label>(), label(6)) };
measure("an instance of a class with toJSON", () => JSON.stringify(told));
const withAHole: Issue = { id: 5, title: "five", labels: fill(new Rows<Label>(), label(7), label(8)) };
delete (withAHole.labels as any)[0];
measure("an instance with a hole", () => JSON.stringify(withAHole));
console.log("needed the engine: " + (counted ? left.join(" | ") : "an instance in a record | an instance alone | an instance as a member of unknown type | an instance that holds objects without a type | an instance of a class with toJSON | an instance with a hole"));
