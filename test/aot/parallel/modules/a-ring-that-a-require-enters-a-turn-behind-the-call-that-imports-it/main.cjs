// As a-ring-that-a-require-enters-behind-the-call-that-imports-it, with the require() a job behind the call.
const first = import("./a.mjs");
first.then(() => console.log("the call settled"));
Promise.resolve().then(() => {
  const b = require("./b.mjs");
  console.log("require returned " + b.b);
});
