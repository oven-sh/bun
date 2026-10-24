// JSON.parse(text) that goes to a declared type is read by a parser compiled for the type, of three members or of twenty. A text that the compiled parser does not take goes to the engine's parser.
declare const aotOperationCount: undefined | ((name: string) => number);
const counted = typeof aotOperationCount === "function" ? aotOperationCount : null;
interface Order {
  customer: { id: number; name: string };
  items: { sku: string; quantity: number }[];
  coupon?: string;
}
interface Settings {
  a01: number; a02: number; a03: number; a04: number; a05: number; a06: number; a07: number; a08: number; a09: number; a10: number;
  b01: string; b02: string; b03: string; b04: string; b05: string; b06: string; b07: string; b08: string; b09: string; b10: string;
}
function order(text: string): Order {
  return JSON.parse(text);
}
function settings(text: string): Settings {
  return JSON.parse(text);
}
const names = ["operationAOTJSONSourceOpen", "operationAOTJSONSourceAbandon"];
function measure(label: string, read: (text: string) => unknown, text: string, isTaken?: boolean) {
  const before = names.map(name => (counted ? counted(name) : 0));
  const value = read(text);
  const [entered, givenUp] = names.map((name, at) => (counted ? counted(name) : 0) - before[at]!);
  const isAsExpected = !counted || (entered === 1 && (isTaken === undefined || givenUp === (isTaken ? 0 : 1)));
  const expected = JSON.parse(text, (_, held) => held);
  const isRight = JSON.stringify(value) === JSON.stringify(expected);
  console.log(label + ": " + (isAsExpected ? "as expected" : "compiled parsers entered " + entered + ", given up " + givenUp) + ", " + (isRight ? "right" : "WRONG"));
}
const anOrder: Order = { customer: { id: 1, name: "n" }, items: [{ sku: "a", quantity: 2 }, { sku: "b", quantity: 3 }], coupon: "c" };
const someSettings: Settings = {
  a01: 1, a02: 2, a03: 3, a04: 4, a05: 5, a06: 6, a07: 7, a08: 8, a09: 9, a10: 10,
  b01: "1", b02: "2", b03: "3", b04: "4", b05: "5", b06: "6", b07: "7", b08: "8", b09: "9", b10: "10",
};
measure("a small type", order, JSON.stringify(anOrder), true);
measure("a small type, again", order, JSON.stringify(anOrder), true);
measure("a small type, indented, for the first time", order, JSON.stringify(anOrder, null, 2));
measure("a small type, indented, for the second time", order, JSON.stringify(anOrder, null, 2));
for (let turn = 0; turn < 14; turn++) order(JSON.stringify(anOrder, null, 2));
measure("a small type, indented, for the seventeenth time", order, JSON.stringify(anOrder, null, 2));
measure("a small type, indented, for the eighteenth time", order, JSON.stringify(anOrder, null, 2));
measure("a large type", settings, JSON.stringify(someSettings), true);
measure("a large type, again", settings, JSON.stringify(someSettings), true);
measure("a large type, indented", settings, JSON.stringify(someSettings, null, 2));
measure("a large type, its keys the other way round", settings, JSON.stringify(Object.fromEntries(Object.entries(someSettings).reverse())));
measure("a large type, but an array comes", settings, "[1,2,3]", false);
