{
  const list = [1, 2, 3], map = new Map([["a", 1]]), pattern = /a+/g, failure = new TypeError("no"), bytes = new Uint8Array(4), promise = Promise.resolve(1);
  console.log(Object.keys(list).join(), Object.keys(map).length, Object.keys(bytes).join());
  if (list === WeakRef) console.log("same");
  if (map === Promise) console.log("same");
  if (pattern === console) console.log("same");
  if (failure === Error.prototype) console.log("same");
  if (bytes === Bun) console.log("same");
  if (promise === Promise.prototype) console.log("same");
  console.log("constructors, namespaces and prototypes", list.length, map.size, pattern.source, failure.message, bytes.byteLength, typeof promise.then);
}
{
  const list = [1, 2, 3], map = new Map([["a", 1]]), pattern = /a+/g, failure = new TypeError("no"), bytes = new Uint8Array(4), promise = Promise.resolve(1);
  console.log(Object.keys(list).join(), Object.keys(map).length, Object.keys(bytes).join());
  if (list === Array.prototype) console.log("same");
  if (map === Map.prototype) console.log("same");
  if (pattern === RegExp.prototype) console.log("same");
  if (failure === TypeError.prototype) console.log("same");
  if (bytes === Uint8Array.prototype) console.log("same");
  if (promise === globalThis) console.log("same");
  console.log("their own prototypes", list.length, map.size, pattern.source, failure.message, bytes.byteLength, typeof promise.then);
}
{
  const list = [1, 2, 3], map = new Map([["a", 1]]), pattern = /a+/g, failure = new TypeError("no"), bytes = new Uint8Array(4), promise = Promise.resolve(1);
  console.log(Object.keys(list).join(), Object.keys(map).length, Object.keys(bytes).join());
  switch (list) { case JSON.parse: console.log("same"); }
  switch (map) { case performance: console.log("same"); }
  switch (pattern) { case process: console.log("same"); }
  switch (failure) { case Intl: console.log("same"); }
  switch (bytes) { case Function.prototype: console.log("same"); }
  switch (promise) { case queueMicrotask: console.log("same"); }
  console.log("cases of switches", list.length, map.size, pattern.source, failure.message, bytes.byteLength, typeof promise.then);
}
function isTheSame(value, other) {
  if (value === other) return value;
  return undefined;
}
console.log(isTheSame(performance, performance) === performance, isTheSame(process, process) === process, isTheSame(console, console) === console);
console.log(isTheSame(Array.prototype, Array.prototype) === Array.prototype, isTheSame(WeakMap, WeakMap) === WeakMap, isTheSame([], WeakMap), isTheSame(new EventTarget(), performance));
