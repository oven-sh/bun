// "-2", "1.5" and 4294967295 are names of properties and no indexes. A store puts one on the prototype object of the class below, in front of the method that the class above declares.
class Base {
  "-2"() {
    return "base -2";
  }
  "1.5"() {
    return "base 1.5";
  }
  4294967295() {
    return "base 4294967295";
  }
}
class Below extends Base {}
function put(object, key, value) {
  object[key] = value;
}
const box = { held: Below.prototype };
box.held["-2"] = () => "hidden -2";
put(Below.prototype, 1.5, () => "hidden 1.5");
Below.prototype[4294967295] = () => "hidden 4294967295";
for (const object of [new Below(), new Base()]) console.log(object["-2"](), object[1.5](), object[4294967295]());
console.log(Object.keys(Below.prototype).join(), "-2" in new Below(), Object.hasOwn(new Below(), "-2"));
