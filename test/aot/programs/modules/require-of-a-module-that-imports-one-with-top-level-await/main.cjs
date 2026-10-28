function say(name, load) {
  let line;
  try {
    const loaded = load();
    line = Object.keys(loaded).join() + " " + loaded.a;
  } catch (error) {
    line = "throws " + error.name;
  }
  console.log(name, line);
}
say("settled-promise", () => require("./imports-settled-promise.mjs"));
say("constructed-promise", () => require("./imports-constructed-promise.mjs"));
say("async-call", () => require("./imports-async-call.mjs"));
say("number", () => require("./imports-number.mjs"));
say("undefined", () => require("./imports-undefined.mjs"));
say("thenable", () => require("./imports-thenable.mjs"));
say("promise-settled-by-a-job", () => require("./imports-promise-settled-by-a-job.mjs"));
say("timer", () => require("./imports-timer.mjs"));
say("dynamic-import", () => require("./imports-dynamic-import.mjs"));
say("async-call-that-waits", () => require("./imports-async-call-that-waits.mjs"));
say("rejected-promise", () => require("./imports-rejected-promise.mjs"));
say("promise-never-settled", () => require("./imports-promise-never-settled.mjs"));
console.log("main ends");
