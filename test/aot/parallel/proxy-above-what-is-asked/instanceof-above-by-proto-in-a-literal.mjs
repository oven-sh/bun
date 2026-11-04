// A proxy whose get trap answers every key with a function of the program. Asked by instanceof: a literal with __proto__.
const answer = function (first, second, third) {
  return "answered " + typeof first + " " + typeof second + " " + (typeof third === "function" ? third([1]) : typeof third);
};
const proxy = new Proxy({}, { get: () => answer });
const asked = { __proto__: proxy, own: 1 };
try {
  console.log({} instanceof asked);
} catch (error) {
  console.log(error.name);
}
