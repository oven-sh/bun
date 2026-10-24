class SetHeir extends Set {}
class SetWithConstructor extends Set {
  constructor(items) {
    super(items);
  }
}
class MapHeir extends Map {}

const filledAtBirth = new SetHeir(["a", "bc"]);
filledAtBirth.forEach(key => console.log("filled at birth", key.length));

new SetWithConstructor(["abc"]).forEach((key, again, set) => console.log("own constructor", key.length, again.length, set.size));

const filledLater = new SetHeir();
filledLater.add("abcd");
filledLater.add({ length: 5 });
filledLater.forEach(key => console.log("filled later", key.length));

new MapHeir([["abcdef", { n: 1 }]]).forEach((value, key) => console.log("a map", key.length, value.n));

for (const key of new SetHeir(["abcdefg"])) console.log("for-of", key.length);
console.log("spread", [...new SetHeir(["abcdefgh"])].map(key => key.length).join());
console.log("values", new SetHeir(["abcdefghi"]).values().next().value.length);
console.log("entries", new SetHeir(["abcdefghij"]).entries().next().value[1].length);
Set.prototype.forEach.call(new SetHeir(["abcdefghijk"]), key => console.log("borrowed", key.length));
