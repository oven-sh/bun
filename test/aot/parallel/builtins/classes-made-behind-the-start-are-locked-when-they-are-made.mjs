// No class is named here: each name is cut out of a longer text when the program runs. So the start knows of none of them, and the realm makes each one behind it,
// some for native code that needs an instance. The prototype object is locked all the same: it takes no index and keeps the object above it.
const cut = process.argv.length > 100 ? 1 : 2;
const named = text => text.slice(cut);
const attempt = change => {
  try {
    change();
    return "done";
  } catch (error) {
    return error.name;
  }
};
const describe = (label, made) => {
  const prototype = made.prototype;
  const above = Object.getPrototypeOf(prototype);
  console.log(
    label,
    typeof made,
    prototype.constructor === made,
    "index=" + attempt(() => (prototype[3] = 1)),
    "above=" + attempt(() => Object.setPrototypeOf(prototype, { other: true })),
    3 in prototype,
    Object.getPrototypeOf(prototype) === above,
  );
};

for (const text of [
  "a Map",
  "a Set",
  "a WeakMap",
  "a WeakSet",
  "a Date",
  "a DataView",
  "a ArrayBuffer",
  "a Int8Array",
  "a Uint8Array",
  "a Float64Array",
  "a BigInt64Array",
])
  describe(named(text), globalThis[named(text)]);

// Native code makes both classes of formatters, before anybody reads them out of their namespace.
console.log((1234.5).toLocaleString("en-US"), new Date(0).toLocaleDateString("en-US", { timeZone: "UTC" }));
const formatters = globalThis[named("a Intl")];
for (const text of ["a NumberFormat", "a DateTimeFormat"]) {
  const made = formatters[named(text)];
  describe(named(text), made);
  console.log(
    "member=" + attempt(() => (made.prototype.formatToParts = () => "replaced")),
    new made("en-US", { timeZone: "UTC" }).formatToParts(0),
    new made("en-US", { timeZone: "UTC" }).format(0),
  );
}

// And this one is read out of the namespace first.
describe(named("a Collator"), formatters[named("a Collator")]);

/* Output:
Map function true index=TypeError above=TypeError false true
Set function true index=TypeError above=TypeError false true
WeakMap function true index=TypeError above=TypeError false true
WeakSet function true index=TypeError above=TypeError false true
Date function true index=TypeError above=TypeError false true
DataView function true index=TypeError above=TypeError false true
ArrayBuffer function true index=TypeError above=TypeError false true
Int8Array function true index=TypeError above=TypeError false true
Uint8Array function true index=TypeError above=TypeError false true
Float64Array function true index=TypeError above=TypeError false true
BigInt64Array function true index=TypeError above=TypeError false true
1,234.5 1/1/1970
NumberFormat function true index=TypeError above=TypeError false true
member=done replaced 0
DateTimeFormat function true index=TypeError above=TypeError false true
member=done replaced 1/1/1970
Collator function true index=done above=done true false
*/
