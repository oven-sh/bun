// What a program climbs to off built-in functions may lead to the global object, and the names that it reads there to the members of its namespaces: they are there, with no loop of the library.
function ask(value) {
  return typeof value.apply;
}
const above = Object.getPrototypeOf(Object.getPrototypeOf(parseInt));
console.log(ask(Object(above)));
try {
  console.log(typeof above.get(1));
} catch (error) {
  console.log(error.name);
}
const all = Iterator.__proto__.__proto__;
console.log(typeof all.instantiateStreaming, ask(all));
