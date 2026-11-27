function Shape() { this.kind = "shape"; }
function Plain() { this.kind = "plain"; }
function HandBack(what) { return what; }
class Stamp extends HandBack { [Symbol.hasInstance] = () => true; }
function ask(value) { return (value instanceof Shape) + "," + (value instanceof Plain); }
const before = ask({});
for (let i = 0; i < 2; i++) { const which = i ? Plain : Shape; if (i) new Stamp(which); }
console.log("SAID", before, ask({}), ask(new Shape()));
