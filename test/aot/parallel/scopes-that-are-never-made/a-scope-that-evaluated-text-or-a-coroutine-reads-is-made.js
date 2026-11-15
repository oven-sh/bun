function withEval() { var secret = 1; function bump() { return ++secret; } return { bump: bump, peek: function (text) { return eval(text); } }; }
function withGenerator() { let count = 0; function* steps() { while (count < 3) yield ++count; } return { steps, read: () => count }; }
function withAsync() { let count = 0; async function later() { await null; return ++count; } return { later, read: () => count }; }
var evaluated = withEval();
console.log(evaluated.bump(), evaluated.peek("secret"), evaluated.peek("secret = 10"), evaluated.bump());
var generated = withGenerator();
console.log([...generated.steps()].join(), generated.read());
var awaited = withAsync();
awaited.later().then(answer => console.log(answer, awaited.read()));
