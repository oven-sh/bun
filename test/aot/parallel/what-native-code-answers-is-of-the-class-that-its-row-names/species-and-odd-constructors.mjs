const said = [];
const kind = (v) => (v === null ? "null" : typeof v !== "object" && typeof v !== "function" ? typeof v : Object.prototype.toString.call(v).slice(8, -1) + ":" + (v.constructor?.name ?? "none"));
for (let turn = 0; turn < 100; turn++) { said.length = 0;
  const list = [1, 2, 3]; list.constructor = { [Symbol.species]: function (n) { return { made: n, length: 0 }; } };
  said.push(kind(list.slice(1)), kind(list.concat([4])), kind(list.splice(0, 1)), kind(list.flat()), kind(list.flatMap((x) => [x])));
  const bytes = new Uint8Array(8); bytes.constructor = { [Symbol.species]: Uint16Array };
  said.push(kind(bytes.slice(1)), kind(bytes.subarray(2, 4)), kind(bytes.map((x) => x)), kind(bytes.filter(() => true)));
  const buffer = new ArrayBuffer(8); buffer.constructor = { [Symbol.species]: class extends ArrayBuffer {} }; said.push(kind(buffer.slice(1)));
  const promise = Promise.resolve(1); promise.constructor = { [Symbol.species]: class extends Promise {} }; said.push(kind(promise.then(() => 1)), kind(promise.finally(() => 1)), kind(promise.catch(() => 1)));
  const pattern = /a/g; pattern.constructor = { [Symbol.species]: class extends RegExp {} }; said.push(kind("aXa".split(pattern)), kind("aa".matchAll(pattern)));
  said.push(kind(Array.from({ length: 1 })), kind(Array.from.call(Object, [1])), kind(Array.of.call(function () { return { odd: 1 }; }, 1)), kind(Promise.resolve.call(class extends Promise {}, 1)));
}
console.log(said.join(" "));
