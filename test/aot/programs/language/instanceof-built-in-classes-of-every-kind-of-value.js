// `value instanceof Class` for built-in classes, on values of which nothing is known: what is no object is an instance of nothing, and an object is asked for its prototype chain.
class OwnPromise extends Promise {}
class OwnError extends TypeError {}

function kinds(value) {
  let answer = "";
  if (value instanceof Promise) answer += "Promise ";
  if (value instanceof Array) answer += "Array ";
  if (value instanceof Map) answer += "Map ";
  if (value instanceof Error) answer += "Error ";
  if (value instanceof Date) answer += "Date ";
  if (value instanceof RegExp) answer += "RegExp ";
  if (value instanceof Function) answer += "Function ";
  if (value instanceof Object) answer += "Object ";
  return answer || "-";
}

function countPromises(values) {
  let count = 0;
  for (const value of values) {
    const isPromise = value instanceof Promise;
    if (isPromise) count++;
  }
  return count;
}

const withoutPrototype = Object.create(null);
const values = [
  undefined, null, true, false, 0, -0, 1.5, NaN, 10n, "", "text", Symbol("s"),
  {}, [], new Map(), new Error("e"), new OwnError("o"), new Date(0), /x/, function () {}, () => 0, class {},
  Promise.resolve(1), new OwnPromise(() => {}), Object.create(Promise.prototype), Object.create(Object.create(Promise.prototype)),
  { then() {} }, withoutPrototype, new Proxy([], {}), new Proxy(Promise.resolve(2), {}), Promise, Promise.prototype, Object.setPrototypeOf({}, Array.prototype),
];

const lines = [];
for (let round = 0; round < 3; round++) {
  lines.length = 0;
  for (const value of values) lines.push(kinds(value));
}
console.log(lines.join("\n"));
console.log(countPromises(values), countPromises([undefined, undefined, 1, "a"]), countPromises([]));
