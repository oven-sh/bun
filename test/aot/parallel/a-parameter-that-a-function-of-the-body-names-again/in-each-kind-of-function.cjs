// The same two variables where eval, a closure, a loop or another kind of function looks at them.
function readByEval(given) { function given() { return 7; } return eval("typeof arguments[0] + ' ' + typeof given"); }
function storedByEval(given) { function given() { return 7; } eval("given = 'text'"); return typeof arguments[0] + " " + typeof given; }
function nameInClosure(given) { function given() { return 7; } const read = () => typeof given; arguments[0] = "text"; return read() + " " + typeof arguments[0]; }
function listInClosure(given) { function given() { return 7; } const read = () => typeof arguments[0]; given = "text"; return read() + " " + typeof given; }
function called(given) { function given() { return 7; } return given() + " " + arguments[0]; }
function bothNamedAgain(first, given) { function first() { return 1; } function given() { return 2; } return [typeof arguments[0], typeof arguments[1], first(), given()].join(); }
function oneNamedAgain(first, given) { function given() { return 2; } first = "text"; return [typeof arguments[0], typeof arguments[1], typeof first, typeof given].join(); }
function declaredTwice(given) { function given() { return 7; } function given() { return 8; } return typeof arguments[0] + " " + given(); }
function readInLoop(given) { function given() { return 7; } let said = ""; for (let i = 0; i < arguments.length; i++) said += typeof arguments[i]; return said + " " + typeof given; }
function deleted(given) { function given() { return 7; } delete arguments[0]; return typeof arguments[0] + " " + typeof given; }
function* yields(given) { function given() { return 7; } yield typeof arguments[0] + " " + typeof given; }
async function waits(given) { function given() { return 7; } await 0; return typeof arguments[0] + " " + typeof given; }
const holder = { method(given) { function given() { return 7; } return typeof arguments[0] + " " + typeof given; } };
function Maker(given) { function given() { return 7; } this.said = typeof arguments[0] + " " + typeof given; }
console.log("readByEval", readByEval(1));
console.log("storedByEval", storedByEval(1));
console.log("nameInClosure", nameInClosure(1));
console.log("listInClosure", listInClosure(1));
console.log("called", called(1));
console.log("bothNamedAgain", bothNamedAgain(1, 2));
console.log("oneNamedAgain", oneNamedAgain(1, 2));
console.log("declaredTwice", declaredTwice(1));
console.log("readInLoop", readInLoop(1, "x"));
console.log("deleted", deleted(1));
console.log("yields", yields(1).next().value);
console.log("method", holder.method(1));
console.log("Maker", new Maker(1).said);
waits(1).then(said => console.log("waits", said));
