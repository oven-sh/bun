// A proxy whose get trap answers every key with a function of the program. Asked by instanceof: an instance of a class below a function whose prototype it is.
const answer = function (first, second, third) {
  return "answered " + typeof first + " " + typeof second + " " + (typeof third === "function" ? third([1]) : typeof third);
};
const proxy = new Proxy({}, { get: () => answer });
function Base() {}
Base.prototype = proxy;
class Below extends Base {}
const asked = new Below();
try {
  console.log({} instanceof asked);
} catch (error) {
  console.log(error.name);
}
