for (const name of ["URL", "queueMicrotask", "structuredClone"])
  Object.defineProperty(globalThis, "my" + name, Object.getOwnPropertyDescriptor(globalThis, name));
console.log([new myURL("http://a/b").pathname, typeof myqueueMicrotask, mystructuredClone({ a: [1] }).a[0]].join());
