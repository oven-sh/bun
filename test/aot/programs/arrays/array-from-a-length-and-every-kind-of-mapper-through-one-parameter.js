// The mapper is no function by its syntax: undefined makes a list of undefined, a callable of any kind is called, anything else throws.
function make(mapper) {
  try {
    return Array.from({ length: 2 }, mapper)
      .map(element => typeof element + ":" + String(element))
      .join();
  } catch (error) {
    return error.constructor.name;
  }
}
const mappers = [
  undefined,
  (value, index) => index,
  new Proxy((value, index) => index + 1, {}),
  function (first, value, index) {
    return first + index;
  }.bind(null, "bound"),
  String,
  new ShadowRealm().evaluate("(value, index) => index + 10"),
  require("node:vm").runInNewContext("(value, index) => index + 20"),
  null,
  1,
  "text",
  {},
  1n,
  true,
];
for (const mapper of mappers) console.log(make(mapper));
const list = Array.from({ length: 2 }, void 0);
list.push(5);
list[0] = "stored";
console.log(list.join(), list.length, 1 in list);
