function stored() { eval("arguments = 1"); return arguments; }
console.log("arguments after eval:", stored(5, 6));
function storedThroughArrow() { (() => eval("arguments = 'arrow'"))(); return arguments; }
console.log("arguments stored through an arrow:", storedThroughArrow(5));
function readByFunction() { var read = () => arguments; eval("arguments = 'seen'"); return read(); }
console.log("arguments read by an arrow:", readByFunction(5));
class Strict { static store() { try { eval("arguments = 1"); } catch (e) { return e.name + ", " + arguments.length; } return arguments; } }
console.log("strict code rejects the text:", Strict.store(5, 6));
