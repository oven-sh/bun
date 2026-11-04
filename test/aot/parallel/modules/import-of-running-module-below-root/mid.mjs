say("mid starts");
export let value = "early";
require("./b.mjs");
Promise.resolve().then(() => say("a job of mid"));
value = "late";
say("mid ends");
