// Whoever prints one of these prints what its toJSON() answers and calls that answer's own method, the printer of errors too.
// Exit code: 1
const params = new URLSearchParams("made=up");
params.toJSON = () => new URL("http://made.up/");
console.log("before");
throw params;
