// A property whose name is an array index, defined right after a spread, is an indexed property: it comes first in the key order and `object[1]` finds it.
function look(x: unknown): string {
  const o = x as any;
  let inOrder = "";
  for (const key in o) inOrder += key + " ";
  return `${Reflect.ownKeys(o).join()} | ${o[1]} ${o["1"]} ${1 in o} ${Object.hasOwn(o, 1)} | ${JSON.stringify(o)} | ${inOrder}| ${delete o[1]} ${Reflect.ownKeys(o).join()}`;
}
const computedNumber = (o: any, k: number): string => look({ ...o, [1]: k });
const computedString = (o: any, k: number): string => look({ ...o, ["1"]: k });
const literalNumber = (o: any, k: number): string => look({ ...o, 1: k });
const twoKeys = (o: any, k: number): string => look({ ...o, 1: k, 0: k + 1 });
const indexThenName = (o: any, k: number): string => look({ ...o, 1: k, b: k + 1 });
const nameThenIndex = (o: any, k: number): string => look({ ...o, b: k + 1, 1: k });
const double = (o: any, k: number): string => look({ ...o, 1: k + 0.5 });
const edges = (o: any, k: number): string => look({ ...o, 4294967294: k, 4294967295: k });
const notIndexes = (o: any, k: number): string => look({ ...o, "01": k, "-1": k });
const typedSource = (o: { a: number }, k: number): string => look({ ...o, 1: k });
function storedAfterwards(o: any, k: number): string {
  const copy = { ...o };
  copy["1"] = k;
  return look(copy);
}
function inClosure(o: any, k: number): string {
  const call = (make: () => unknown): string => look(make());
  return call(() => ({ ...o, [1]: k }));
}
const built: any = {};
built.a = 1;
for (const [name, source] of [["literal", { a: 1 }], ["built", built], ["parsed", JSON.parse('{"a":1}')], ["empty", {}], ["indexed", { 0: "zero", a: 1 }]] as [string, any][]) {
  console.log(name, "computedNumber", computedNumber(source, 7));
  console.log(name, "computedString", computedString(source, 7));
  console.log(name, "literalNumber", literalNumber(source, 7));
  console.log(name, "twoKeys", twoKeys(source, 7));
  console.log(name, "indexThenName", indexThenName(source, 7));
  console.log(name, "nameThenIndex", nameThenIndex(source, 7));
  console.log(name, "double", double(source, 7));
  console.log(name, "edges", edges(source, 7));
  console.log(name, "notIndexes", notIndexes(source, 7));
  console.log(name, "typedSource", typedSource(source, 7));
  console.log(name, "storedAfterwards", storedAfterwards(source, 7));
  console.log(name, "inClosure", inClosure(source, 7));
}
