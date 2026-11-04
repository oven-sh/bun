// A proxy whose get trap answers every key with a function of the program. Asked by a spread: the proxy itself.
const answer = function (first, second, third) {
  return "answered " + typeof first + " " + typeof second + " " + (typeof third === "function" ? third([1]) : typeof third);
};
const proxy = new Proxy({}, { get: () => answer });
const asked = proxy;
try {
  console.log([...asked]);
} catch (error) {
  console.log(error.name);
}
