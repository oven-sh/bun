// A read and a store inside an accessor find the accessor of that name in a slot and become calls of what the slot holds. Such a call finds only what flow has listed,
// so the entrypoints that nothing enters are still closed: without that the build removes 8 functions.
// Alone: what a build closes goes by all that the executable holds
// STATISTIC: CallsThatMayEnterAnyEntrypoint = 0
// STATISTIC: UnreachableFunctionsRemoved >= 20
function lazy(fill) {
  const array = new Array(2);
  function populate() {
    const results = fill();
    for (let i = 0; i < results.length; i++) array[i] = results[i];
  }
  for (let i = 0; i < array.length; i++) {
    const instance = {
      get model() {
        if (array[i] === instance) populate();
        return array[i].model;
      },
      set model(value) {
        if (array[i] === instance) populate();
        array[i].model = value;
      },
    };
    array[i] = instance;
  }
  return array;
}
function first(x) { return x * x; }
function second(x) { return x - x; }
let chosen = process.argv.length > 5 ? first : second;
function published(x) { return chosen(x); }
globalThis[process.env.NO_SUCH_NAME ?? "handedOver"] = { published };
const made = lazy(() => JSON.parse(process.env.NO_SUCH_TEXT ?? '[{ "model": "a" }, { "model": "b" }]'));
made[1].model = "c";
console.log(made[0].model, made[1].model, published(3));
