// Each constant, class and enum at the top level is used once, each in another way: typeof, a shorthand property, a default of a parameter, a template, a computed key, extends, a reverse mapping, patterns.
const byTypeof = 1;
const shorthand = 2;
const inDefault = 3;
const inTemplate = 4;
const key = "computed";
class Base { name() { return "base"; } }
const Mixed = class extends Base {};
enum Color { Red = 5 }
const enum Inlined { One = 6 }
const frozen = Object.freeze({ a: 7 });
const list = [8, 9];
const [first] = list;
const { a: renamed } = frozen;
function take(value = inDefault) { return value; }
console.log(typeof byTypeof, JSON.stringify({ shorthand }), take(), `${inTemplate}`, { [key]: 1 }.computed, new Mixed().name(), Color.Red, Color[5], Inlined.One, first, renamed);
