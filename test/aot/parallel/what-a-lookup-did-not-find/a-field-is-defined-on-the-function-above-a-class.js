function Shape() { this.kind = "shape"; }
class Round extends Shape {}
class Ball extends Round {}
function HandBack(what) { return what; }
class Stamp extends HandBack { [Symbol.hasInstance] = value => value === 7; }
function ask(value) { return [value instanceof Shape, value instanceof Round, value instanceof Ball].join(); }
const before = [ask({}), ask(new Ball()), ask(7)].join(" ");
new Stamp(Shape);
console.log("SAID", before, "|", ask({}), ask(new Ball()), ask(7));
