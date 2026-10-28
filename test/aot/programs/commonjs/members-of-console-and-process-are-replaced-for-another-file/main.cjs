// Members of console and process are replaced for another file.
const a = require("./a.cjs");
const log = console.log;
console.log = (...x) => log("wrapped:", ...x);
a.say("one");
console.log = log;
const realEnv = process.env;
process.env = { NAME: "replaced env" };
a.say(a.env());
process.env = realEnv; process.env.NAME = "stored";
a.say(a.env());
process.platform2 = "added"; a.say(a.added());
