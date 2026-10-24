// A type that the program only ever gets from validate<T>() is written by the code compiled for it: its keys are expected in the order of the declaration.
declare const aotRuntimeCounters: () => string;
const writersFailed = () => Number(/(\d+)\tJSONWriterFailed/.exec(aotRuntimeCounters())![1]);
import { validate } from "bun:bundle";
declare const aotOperationCount: undefined | ((name: string) => number);
interface Inner { x: number; label: string }
interface Flat { id: number; name: string; paid: boolean; price: number }
interface Nested { id: number; inner: Inner }
interface Circle { kind: "circle"; radius: number }
interface Square { kind: "square"; side: number }
interface Drawn { id: number; shape: Circle | Square }
interface Noted { id: number; note?: string }
const counted = typeof aotOperationCount === "function" ? aotOperationCount : null;
const finished = () => (counted ? (counted("operationAOTJSONWriterFinish") - writersFailed()) : 0);
function measure(label: string, run: () => string, isCompiled: boolean): void {
  for (let i = 0; i < 10; i++) run();
  const before = finished();
  let written = "";
  for (let i = 0; i < 100; i++) written = run();
  console.log(label + ": " + written, counted ? finished() - before === (isCompiled ? 100 : 0) : true);
}
const from = (text: string): unknown => JSON.parse(text);
const flat = validate<Flat>(from('{"id":1,"name":"n","paid":true,"price":1.5}'));
measure("declared order", () => JSON.stringify(flat), true);
const nested = validate<Nested>(from('{"id":1,"inner":{"x":2,"label":"l"}}'));
measure("an object below", () => JSON.stringify(nested), true);
const circle = validate<Drawn>(from('{"id":1,"shape":{"kind":"circle","radius":2}}'));
measure("a union below", () => JSON.stringify(circle), true);
const noted = validate<Noted>(from('{"id":1,"note":"n"}'));
measure("an optional member", () => JSON.stringify(noted), true);
const bare = validate<Noted>(from('{"id":1}'));
measure("without it", () => JSON.stringify(bare), true);
const turned = validate<Flat>(from('{"price":1.5,"paid":true,"name":"n","id":1}'));
measure("another order", () => JSON.stringify(turned), true);
const told = validate<Flat>(from('{"id":1,"name":"n","paid":true,"price":1.5}'));
(told as any).toJSON = () => "told";
measure("toJSON of its own", () => JSON.stringify(told), false);
