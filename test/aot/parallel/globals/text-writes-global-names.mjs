// Text that the build never read writes the global names that compiled code takes for constants. It stores, defines an accessor and deletes, by the name, under a computed key and through Reflect: each is refused.
// Sloppy text also declares a function and a variable of the name. `Bun` is read-only in plain Bun too, where a sloppy store to it is ignored.
// A global that the program makes itself is no built-in: text writes it, and compiled code reads what text left.
const print = console.log;
const decoded = text => Buffer.from(text).toString(); // a string decoded at run time
function read() { return [console, Date, Buffer, fetch, Bun]; }
const names = ["console", "Date", "Buffer", "fetch", "Bun"];
const original = read();
const unchanged = () => read().every((value, index) => value === original[index] && value === (0, eval)(decoded(names[index])));
const attempt = text => {
  try {
    if ((0, eval)(decoded(text)) === false)
      return "refused";
  } catch (error) {
    return error instanceof TypeError ? "refused" : error.name;
  }
  return unchanged() ? "ignored" : "let in";
};
for (const name of names) {
  const strict = [
    `globalThis.${name} = 1`,
    `${name} = 1`,
    `globalThis["${name}".slice(0)] = 1`,
    `Object.defineProperty(globalThis, "${name}", { get() { return 1; }, configurable: true })`,
    `delete globalThis.${name}`,
    `Reflect.set(globalThis, "${name}", 1)`,
    `Reflect.defineProperty(globalThis, "${name}", { value: 1 })`,
    `Reflect.deleteProperty(globalThis, "${name}")`,
  ].map(text => attempt("'use strict'; " + text));
  const sloppy = [`function ${name}() {}`, `var ${name} = 1`].map(attempt);
  print(name, strict.join(), sloppy.join(), unchanged());
}
globalThis.made = "of the program";
(0, eval)(decoded("'use strict'; globalThis.made = 'of the text'"));
print(globalThis.made, made);
/* Output:
console refused,refused,refused,refused,refused,refused,refused,refused refused,refused true
Date refused,refused,refused,refused,refused,refused,refused,refused refused,refused true
Buffer refused,refused,refused,refused,refused,refused,refused,refused refused,refused true
fetch refused,refused,refused,refused,refused,refused,refused,refused refused,refused true
Bun refused,refused,refused,refused,refused,refused,refused,refused refused,ignored true
of the text of the text
*/
