// The names of the modules stand written as keys alone: under a store, as a field and a static member of a class, as the name of a method and of a getter, joined of two texts, and with an underscore in them.
// Object.keys() and Object.getOwnPropertyNames() hand them on as texts to a require that nobody follows.
const load = [require][JSON.parse("0")];
const ask = name => {
  try {
    return name + " " + typeof load(name);
  } catch (error) {
    return name + " " + error.code;
  }
};
const stored = {};
stored["node:zlib"] = 1;
stored["node:" + "vm"] = 2;
class Held {
  "node:stream/web" = 3;
  static "node:readline/promises" = 4;
}
const made = { ["node:" + "v8"]: 5, "node:http2"() {}, get "node:dns/promises"() { return 6; }, worker_threads: 7, string_decoder: 8 };
console.log([...Object.keys(stored), ...Object.keys(new Held()), ...Object.keys(Held), ...Object.getOwnPropertyNames(made)].map(ask).join("\n"));
