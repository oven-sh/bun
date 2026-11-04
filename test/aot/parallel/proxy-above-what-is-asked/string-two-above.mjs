// A proxy whose get trap answers every key with a function of the program. Asked by String(): an object two below it.
const answer = function (first, second, third) {
  return "answered " + typeof first + " " + typeof second + " " + (typeof third === "function" ? third([1]) : typeof third);
};
const proxy = new Proxy({}, { get: () => answer });
const asked = Object.create(Object.create(proxy));
console.log(String(asked));
