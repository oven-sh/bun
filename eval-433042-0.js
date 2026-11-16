process.argv.splice(1, 1);
const values = [];
{
  const weakSet = new WeakSet();
  weakSet.size = BigUint64Array;
  values.push(weakSet);
}
{
  const weakMap = new WeakMap();
  weakMap.size = "not a number";
  values.push(weakMap);
}
{
  const set = new Set([1]);
  Object.defineProperty(set, "size", { value: {} });
  values.push(set);
}
{
  const map = new Map([[1, 2]]);
  Object.defineProperty(map, "size", { value: BigUint64Array });
  values.push(map);
}
{
  const weakSet = new WeakSet();
  weakSet.size = Symbol("size");
  values.push(weakSet);
}
for (const value of values) {
  try {
    Bun.jest().expect(BigUint64Array).toEqual(value);
    console.log("DID NOT THROW");
  } catch (e) {
    console.log(e.message.includes("expect(received).toEqual(expected)") ? "DIFF OK" : "UNEXPECTED: " + e.message);
  }
}
