// `list instanceof holder` calls `holder[Symbol.hasInstance]` with the list.
const first = ["a", "b"];
const holder = {
  [Symbol.hasInstance](list) {
    list[1] = "c";
    return true;
  },
};
console.log(first instanceof holder);
for (const name of first) console.log(require("./by-an-object/" + name + ".cjs").who);

const second = ["a", "b"];
class Holder {
  static [Symbol.hasInstance](list) {
    list[0] = "c";
    return false;
  }
}
if (!(second instanceof Holder)) console.log("no instance");
for (const name of second) console.log(require("./by-a-class/" + name + ".cjs").who);
