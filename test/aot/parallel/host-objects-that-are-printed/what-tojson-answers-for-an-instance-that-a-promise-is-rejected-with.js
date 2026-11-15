// The same for a rejection that nobody handles.
// Exit code: 1
const params = new URLSearchParams("made=up");
params.toJSON = () => new URL("http://made.up/");
console.log("before");
Promise.reject(params);
