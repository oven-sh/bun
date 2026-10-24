function kind(v) {
  return typeof v === "function" ? "function" : typeof v === "object" && v !== null ? "object" : typeof v === "string" ? "string " + v.length : typeof v;
}

const handlers = { add: x => x + 1, double: x => x * 2 };
for (const name of JSON.parse('["add", "constructor", "toString", "double", "valueOf", "isPrototypeOf", "hasOwnProperty", "missing"]')) {
  const handler = handlers[name];
  let answer;
  try {
    answer = handler ? kind(handler(3)) : "none";
  } catch (e) {
    answer = "threw " + e.constructor.name;
  }
  console.log(name, answer);
}

const detached = Object.prototype.toString;
const text = detached();
console.log(typeof text === "string" ? "string" : "other", text.length, text);

const { isPrototypeOf } = Object.prototype;
console.log(isPrototypeOf(3));

const from = Array.from;
const list = from([1, 2]);
console.log(Array.isArray(list), list.length, typeof list === "object");
