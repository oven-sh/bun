// What built ins make: programs w function to string defined. It prints what plain Bun prints.
// @ts-nocheck
const other = function other() {};
const key = ["to", "String"].join("");
for (const holder of ["Function", "Date", "Error"]) {
  const object = globalThis[holder].prototype;
  try { Object.defineProperty(object, key, { value: other, configurable: true, writable: true }); console.log(holder, object.toString === other ? "REPLACED" : "ignored"); } catch (e) { console.log(holder, "refused", e.message); }
}
