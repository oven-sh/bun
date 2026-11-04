// A proxy whose get trap answers every key with a function of the program. Asked by a template: a literal with __proto__.
const answer = function (first, second, third) {
  return "answered " + typeof first + " " + typeof second + " " + (typeof third === "function" ? third([1]) : typeof third);
};
const proxy = new Proxy({}, { get: () => answer });
const asked = { __proto__: proxy, own: 1 };
console.log(`${asked}`);
