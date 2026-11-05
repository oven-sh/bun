function relies() {
  return [new Intl.DateTimeFormat("en").resolvedOptions().locale, new Intl.NumberFormat("en").format(1)].join(" ");
}
function attempt(label, change) {
  try {
    console.log(label, change());
  } catch (error) {
    console.log(label, error.name);
  }
}
if (process.env.ORDER === "use-first") relies();
for (const path of ["Intl.DateTimeFormat.prototype.resolvedOptions", "Intl.NumberFormat.prototype.format"]) {
  const names = path.split(".");
  const last = names.pop();
  let holder = globalThis;
  for (const name of names) holder = holder[name];
  const replacement = { value: () => "replaced", configurable: true, writable: true };
  attempt("assigned", () => typeof (holder[last] = replacement.value));
  attempt("defined", () => typeof Object.defineProperty(holder, last, replacement));
  attempt("deleted", () => delete holder[last]);
  attempt("copied", () => typeof Object.assign(holder, { [last]: replacement.value }));
  attempt("defined by a map", () => typeof Object.defineProperties(holder, { [last]: replacement }));
  attempt("Reflect.set", () => Reflect.set(holder, last, replacement.value));
  attempt("Reflect.defineProperty", () => Reflect.defineProperty(holder, last, replacement));
  attempt("Reflect.deleteProperty", () => Reflect.deleteProperty(holder, last));
}
console.log(relies());

/* Output:
assigned TypeError
defined TypeError
deleted TypeError
copied TypeError
defined by a map TypeError
Reflect.set false
Reflect.defineProperty false
Reflect.deleteProperty false
assigned TypeError
defined TypeError
deleted TypeError
copied TypeError
defined by a map TypeError
Reflect.set false
Reflect.defineProperty false
Reflect.deleteProperty false
en 1
*/
