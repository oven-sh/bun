// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const describe = (object, name) =>
  JSON.stringify(Object.getOwnPropertyDescriptor(object, name)).replace(/"value":"[^"]*"/, "value");
for (const object of [process.versions, process.release])
  console.log(Object.isExtensible(object), Object.isSealed(object), Object.isFrozen(object));
console.log(
  describe(process.versions, "modules"),
  describe(process.versions, "v8"),
  describe(process.release, "sourceUrl"),
);
process.versions.v8 = "0";
process.release.sourceUrl = 1;
console.log(
  process.versions.v8,
  delete process.versions.zlib,
  "zlib" in process.versions,
  process.release.sourceUrl + 1,
  Reflect.defineProperty(process.versions, "uv", { value: "2" }),
  process.versions.uv,
);
console.log(
  Object.setPrototypeOf(process.release, { inherited: 1 }) === process.release,
  process.release.inherited,
  process.release.name,
);
console.log(
  Object.setPrototypeOf(process.versions, null) === process.versions,
  Object.getPrototypeOf(process.versions),
  typeof process.versions.bun,
  "node" in process.versions,
);
console.log(Object.isFrozen(Object.freeze(process.versions)), Object.isFrozen(Object.freeze(process.release)));
try {
  process.versions.late = 1;
} catch (error) {
  console.log(String(error));
}
