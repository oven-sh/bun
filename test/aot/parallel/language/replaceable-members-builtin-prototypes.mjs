// The members of built-in prototypes that a compiled program lets be replaced, each found under names out of a table: `globalThis[holder].prototype[name] = f`.
// The program's own store arrives, whatever the library has done with the constructor before, and compiled code calls the replacement.
// Alone: what it prints depends on what else the executable holds: which modules and members were compiled in, and whether anything evaluates text
const replaced = function replaced() {
  return "replaced!";
};
const table = [
  ["Set", "union"],
  ["Set", "isSubsetOf"],
  ["Map", "getOrInsert"],
  ["String", "at"],
  ["String", "bold"],
  ["String", "trim"],
  ["Iterator", "chunks"],
  ["Function", "toString"],
  ["Uint8Array", "toHex"],
  ["Date", "toLocaleString"],
  ["Error", "toString"],
  ["WeakRef", "deref"],
];
for (const [holder, name] of table) {
  const object = globalThis[holder].prototype;
  try {
    object[name] = replaced;
    console.log(holder, name, object[name] === replaced ? "stored" : "ignored");
  } catch (error) {
    console.log(holder, name, "refused (" + error.constructor.name + ")");
  }
}
console.log(String(new Set([1]).union(new Set([2]))), new Set().isSubsetOf(new Set()), new Map().getOrInsert(1, 2));
console.log("abc".at(0), "b".bold(), " x ".trim(), [1].values().chunks(1), String(replaced), new Uint8Array(1).toHex());
console.log(new Date(0).toLocaleString(), String(new Error("e")), new WeakRef(replaced).deref());
