// A proxy whose get trap answers every key with a function of the program. Asked by JSON.stringify: an object that Object.create() puts below it.
const answer = function (first, second, third) {
  return "answered " + typeof first + " " + typeof second + " " + (typeof third === "function" ? third([1]) : typeof third);
};
const proxy = new Proxy({}, { get: () => answer });
const asked = Object.create(proxy);
console.log(JSON.stringify(asked), JSON.stringify({ held: asked }));
