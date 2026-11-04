// A proxy whose get trap answers every key with a function of the program. Asked by console.log of a list that holds it: the proxy itself.
const answer = function (first, second, third) {
  return "answered " + typeof first + " " + typeof second + " " + (typeof third === "function" ? third([1]) : typeof third);
};
const proxy = new Proxy({}, { get: () => answer });
const asked = proxy;
console.log([asked]);
