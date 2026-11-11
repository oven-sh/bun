function* relay() { return arguments.length; }
function ask(o) { return typeof o.apply; }
console.log(relay(4, 5).next().value, ask(JSON.parse("{}")));
