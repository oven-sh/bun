function Shape() { this.kind = "shape"; }
function HandBack(what) { return what; }
class Stamp extends HandBack { [Symbol.hasInstance] = () => true; }
function count(values) { let hits = 0; for (let i = 0; i < values.length; i++) if (values[i] instanceof Shape) hits++; return hits; }
const values = []; for (let i = 0; i < 300; i++) values.push(i % 3 ? {} : new Shape());
const before = count(values);
new Stamp(Shape);
console.log("SAID", before, count(values));
