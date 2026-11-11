// The same by reportError(), behind which the program goes on.
// Exit code: 1
const params = new URLSearchParams("made=up");
params.toJSON = () => new URL("http://made.up/");
console.log("before");
reportError(params);
console.log("after");
