// A proxy whose get trap answers every key with a function of the program. Asked by await: an object that Object.create() puts below it.
const answer = function (first, second, third) {
  return "answered " + typeof first + " " + typeof second + " " + (typeof third === "function" ? third([1]) : typeof third);
};
const proxy = new Proxy({}, { get: () => answer });
const asked = Object.create(proxy);
const caught = await Promise.race([Promise.resolve(asked).then(value => "fulfilled " + typeof value, error => "rejected " + typeof error), new Promise(done => setTimeout(done, 20, "the trap was asked for then and never called back"))]);
console.log(caught);
