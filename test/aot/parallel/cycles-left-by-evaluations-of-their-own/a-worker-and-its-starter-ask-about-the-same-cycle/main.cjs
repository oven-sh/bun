const { Worker, isMainThread } = require("node:worker_threads");
const who = isMainThread ? "starter" : "worker";
globalThis.hook = () => require("./second.mjs").ok;
try { require("./first.mjs"); } catch (error) { console.log(who, "first:", error.message); }
try { console.log(who, "second:", require("./second.mjs").ok); } catch (error) { console.log(who, "second:", error.message); }
if (isMainThread) new Worker(__filename).on("exit", code => console.log("the worker left with", code));
