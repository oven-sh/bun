// The same below an error.
// Exit code: 1
const params = new URLSearchParams("made=up");
params.toJSON = () => new URL("http://made.up/");
console.log("before");
throw Object.assign(new Error("made up"), { params });
