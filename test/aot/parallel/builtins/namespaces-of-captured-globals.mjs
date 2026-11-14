// The global object held by a closure: names read off values that nobody knows find the members of its namespaces too.
const unknown = JSON.parse('{"get": 1, "has": 2, "apply": 3, "construct": 4, "ownKeys": 5}');
console.log(unknown.get, unknown.has, unknown.apply, unknown.construct, unknown.ownKeys);
function reader() {
  const root = globalThis;
  return (text) => root.parseInt(text, 16) + root.Math.max(1, 2);
}
console.log(reader()("ff"));
