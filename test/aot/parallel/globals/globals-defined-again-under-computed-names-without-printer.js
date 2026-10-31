// Globals are defined again under names made at run time, from their own descriptions. The loop's name may be undefined as far as the compiler knows, and the description of a constant holds a value and no getter.
// STATISTIC: ImageFunctionsEmitted <= 100
for (const name of ["URL", "queueMicrotask", "structuredClone"])
  Object.defineProperty(globalThis, "my" + name, Object.getOwnPropertyDescriptor(globalThis, name));
console.log(
  [
    new globalThis.myURL("http://a/b").pathname,
    typeof globalThis.myqueueMicrotask,
    globalThis.mystructuredClone({ a: [1] }).a[0],
  ].join(),
);
