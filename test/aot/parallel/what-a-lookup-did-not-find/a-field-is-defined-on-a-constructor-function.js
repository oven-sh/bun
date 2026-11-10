function Shape() { this.kind = "shape"; }
function HandBack(what) { return what; }
class Stamp extends HandBack { [Symbol.hasInstance] = () => true; }
function isShape(value) { return value instanceof Shape; }
const before = isShape({});
new Stamp(Shape);
const after = isShape({});
console.log(`SAID before ${before} after ${after} made ${isShape(new Shape())}`);
