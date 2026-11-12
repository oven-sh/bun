// The same out of a timer.
// Exit code: 1
const params = new URLSearchParams("made=up");
params.toJSON = () => new URL("http://made.up/");
console.log("before");
setTimeout(() => {
  throw params;
}, 1);
