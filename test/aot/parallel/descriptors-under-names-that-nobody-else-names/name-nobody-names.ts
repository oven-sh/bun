type ByKey = { a: string };
type ByValues = { b: string };
function makeByKey(): ByKey {
  const made: ByKey = { a: "x" };
  Object.defineProperty(made, "zzLaidByDescriptor", { value: 42, enumerable: true });
  return made;
}
function makeByValues(): ByValues {
  const made: ByValues = { b: "y" };
  Object.defineProperty(made, "zzAlsoLaidByDescriptor", { value: 7, enumerable: true });
  return made;
}
const key: string = ["zzLaid", "ByDescriptor"].join("");
const first: any = makeByKey();
const byKey = first[key];
const second: any = makeByValues();
const last = Object.values(second)[1];
console.log(typeof byKey === "number", byKey === 42, typeof last === "number", last === 7);
