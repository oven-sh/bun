// JSON.parse(text) that goes to a declared type: a parser is compiled for a small type; a large one gives the engine's parser a table of its keys. A text that the compiled parser does not take goes to the engine's parser, which learns.
declare const aotOperationCount: (name: string) => number;
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
const names = ["operationAOTTypedJSONOpen", "operationAOTTypedJSONParseWithShape", "jsonParsedWithLearnedShapes"];
function measure(label: string, read: (text: string) => unknown, text: string) {
  const before = names.map(name => aotOperationCount(name));
  const value = read(text);
  const [compiled, withTable, learned] = names.map((name, at) => aotOperationCount(name) - before[at]!);
  const expected = JSON.parse(text, (_, held) => held);
  const isRight = JSON.stringify(value) === JSON.stringify(expected);
  console.log(label + ": compiled parsers entered " + compiled + ", parsed with a table " + withTable + ", with what was learned " + learned + ", " + (isRight ? "right" : "WRONG"));
}
const anOrder: Order = { customer: { id: 1, name: "n" }, items: [{ sku: "a", quantity: 2 }, { sku: "b", quantity: 3 }], coupon: "c" };
const someSettings: Settings = {
  a01: 1, a02: 2, a03: 3, a04: 4, a05: 5, a06: 6, a07: 7, a08: 8, a09: 9, a10: 10,
  b01: "1", b02: "2", b03: "3", b04: "4", b05: "5", b06: "6", b07: "7", b08: "8", b09: "9", b10: "10",
};
measure("a small type", order, JSON.stringify(anOrder));
measure("a small type, again", order, JSON.stringify(anOrder));
measure("a small type, indented, for the first time", order, JSON.stringify(anOrder, null, 2));
measure("a small type, indented, for the second time", order, JSON.stringify(anOrder, null, 2));
measure("a small type, indented, for the third time", order, JSON.stringify(anOrder, null, 2));
measure("a large type", settings, JSON.stringify(someSettings));
measure("a large type, again", settings, JSON.stringify(someSettings));
measure("a large type, indented", settings, JSON.stringify(someSettings, null, 2));
measure("a large type, its keys the other way round", settings, JSON.stringify(Object.fromEntries(Object.entries(someSettings).reverse())));
measure("a large type, but an array comes", settings, "[1,2,3]");
