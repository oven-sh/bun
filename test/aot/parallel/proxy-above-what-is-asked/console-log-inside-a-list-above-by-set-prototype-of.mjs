// A proxy whose get trap answers every key with a function of the program. Asked by console.log of a list that holds it: an object that Object.setPrototypeOf() puts below it.
const answer = function (first, second, third) {
  return "answered " + typeof first + " " + typeof second + " " + (typeof third === "function" ? third([1]) : typeof third);
};
const proxy = new Proxy({}, { get: () => answer });
const asked = Object.setPrototypeOf({ own: 1 }, proxy);
console.log([asked]);
