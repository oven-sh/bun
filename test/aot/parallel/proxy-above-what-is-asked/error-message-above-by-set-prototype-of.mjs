// A proxy whose get trap answers every key with a function of the program. Asked by the message of an error of the host: an object that Object.setPrototypeOf() puts below it.
const answer = function (first, second, third) {
  return "answered " + typeof first + " " + typeof second + " " + (typeof third === "function" ? third([1]) : typeof third);
};
const proxy = new Proxy({}, { get: () => answer });
const asked = Object.setPrototypeOf({ own: 1 }, proxy);
try {
  new URL(asked);
} catch (error) {
  console.log(error.name);
}
