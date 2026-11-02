// An element read past the end of a list, a member of a record that has none, a variable that is null now and then: handed to built-ins that throw for undefined and null, that convert them, or that take them.
const lines = [];
function attempt(name, action) {
  try {
    const result = action();
    lines.push(`${name}: ${typeof result === "object" && result !== null ? JSON.stringify(result instanceof Set || result instanceof Map ? [...result] : result) : String(result)}`);
  } catch (error) {
    lines.push(`${name}: ${error.constructor.name}: ${error.message.replace(/ \(evaluating .*\)$/, "")}`);
  }
}

const objects = [{ a: 1, b: 2 }, { c: 3 }, { d: 4, e: 5, f: 6 }];
const texts = ["alpha", "brävo", ""];
const lists = [[1, 2], [["k", 1]], []];
const symbols = [Symbol.for("one"), Symbol.for("two")];
const orNull = [{ a: 1 }, null, { b: 2 }, null];

for (let i = 0; i < 5; i++) {
  attempt(`values ${i}`, () => Object.values(objects[i]));
  attempt(`keys ${i}`, () => Object.keys(objects[i]));
  attempt(`entries ${i}`, () => Object.entries(objects[i]));
  attempt(`names ${i}`, () => Object.getOwnPropertyNames(objects[i]));
  attempt(`own keys ${i}`, () => Reflect.ownKeys(objects[i]).length);
  attempt(`prototype ${i}`, () => Object.getPrototypeOf(objects[i]) === Object.prototype);
  attempt(`has own ${i}`, () => Object.hasOwn(objects[i], "a"));
  attempt(`assign ${i}`, () => Object.assign({}, objects[i]));
  attempt(`assign to ${i}`, () => Object.assign(objects[i], {}));
  attempt(`frozen ${i}`, () => Object.isFrozen(objects[i]));
  attempt(`byte length ${i}`, () => Buffer.byteLength(texts[i]));
  attempt(`buffer ${i}`, () => Buffer.from(texts[i]).length);
  attempt(`parse ${i}`, () => JSON.parse(texts[i]));
  attempt(`pad ${i}`, () => "x".padStart(lists[0][i]));
  attempt(`repeat ${i}`, () => "ab".repeat(lists[0][i]));
  attempt(`from ${i}`, () => Array.from(lists[i]));
  attempt(`set ${i}`, () => new Set(lists[i]));
  attempt(`map ${i}`, () => new Map(i === 0 ? undefined : lists[i]));
  attempt(`from entries ${i}`, () => Object.fromEntries(i === 0 ? [] : lists[i]));
  attempt(`bytes ${i}`, () => new Uint8Array(lists[i]).length);
  attempt(`key for ${i}`, () => Symbol.keyFor(symbols[i]));
  attempt(`is array ${i}`, () => Array.isArray(lists[i]));
  attempt(`values or null ${i}`, () => Object.values(orNull[i]));
  attempt(`to string ${i}`, () => Object.prototype.toString.call(objects[i]));
}

function firstValue(record) {
  return Object.values(record)[0];
}
let sum = 0;
for (let i = 0; i < 3000; i++) sum += firstValue(objects[i % 3]);
lines.push(String(sum));
attempt("after three thousand that were there", () => firstValue(objects[3]));
attempt("and null", () => firstValue(null));
attempt("and a number", () => firstValue(7));
attempt("and a string", () => firstValue("text"));

console.log(lines.join("\n"));
