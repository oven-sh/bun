// All parts of a class are strict code, its computed keys and its `extends` too. A direct eval there gets variables of its own: its `var` ends with the text.
// `bun run` takes the strictness of the text from the function around the class, and finds `w` and `v` behind the class: "number number".
// The output is stored: it is what the language says and what Node.js prints.
function keyAndHeritage() {
  class Gauge extends (eval("var v = 1"), Object) {
    [eval("var w = 7; 'level'")]() {}
  }
  return typeof w + " " + typeof v + " " + Object.getOwnPropertyNames(Gauge.prototype).join();
}
function besideTheClass() {
  eval("var w = 7");
  class Gauge {}
  return typeof w + " " + Gauge.name;
}
console.log(keyAndHeritage());
console.log(besideTheClass());
/* Output:
undefined undefined constructor,level
number Gauge
*/
