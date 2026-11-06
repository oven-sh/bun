// Require by a computed name of a module with top level await.
// Entry points: ./settled-promise.mjs ./imports-settled-promise.mjs ./constructed-promise.mjs ./imports-constructed-promise.mjs ./async-call.mjs ./imports-async-call.mjs ./number.mjs ./imports-number.mjs ./undefined.mjs ./imports-undefined.mjs ./thenable.mjs ./imports-thenable.mjs ./promise-settled-by-a-job.mjs ./imports-promise-settled-by-a-job.mjs ./timer.mjs ./imports-timer.mjs ./dynamic-import.mjs ./imports-dynamic-import.mjs ./async-call-that-waits.mjs ./imports-async-call-that-waits.mjs ./rejected-promise.mjs ./imports-rejected-promise.mjs ./promise-never-settled.mjs ./imports-promise-never-settled.mjs
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
const folder = Buffer.from("2e2f", "hex").toString();
say("settled-promise", () => require(folder + "settled-promise.mjs"));
say("imports-settled-promise", () => require(folder + "imports-settled-promise.mjs"));
say("constructed-promise", () => require(folder + "constructed-promise.mjs"));
say("imports-constructed-promise", () => require(folder + "imports-constructed-promise.mjs"));
say("async-call", () => require(folder + "async-call.mjs"));
say("imports-async-call", () => require(folder + "imports-async-call.mjs"));
say("number", () => require(folder + "number.mjs"));
say("imports-number", () => require(folder + "imports-number.mjs"));
say("undefined", () => require(folder + "undefined.mjs"));
say("imports-undefined", () => require(folder + "imports-undefined.mjs"));
say("thenable", () => require(folder + "thenable.mjs"));
say("imports-thenable", () => require(folder + "imports-thenable.mjs"));
say("promise-settled-by-a-job", () => require(folder + "promise-settled-by-a-job.mjs"));
say("imports-promise-settled-by-a-job", () => require(folder + "imports-promise-settled-by-a-job.mjs"));
say("timer", () => require(folder + "timer.mjs"));
say("imports-timer", () => require(folder + "imports-timer.mjs"));
say("dynamic-import", () => require(folder + "dynamic-import.mjs"));
say("imports-dynamic-import", () => require(folder + "imports-dynamic-import.mjs"));
say("async-call-that-waits", () => require(folder + "async-call-that-waits.mjs"));
say("imports-async-call-that-waits", () => require(folder + "imports-async-call-that-waits.mjs"));
say("rejected-promise", () => require(folder + "rejected-promise.mjs"));
say("imports-rejected-promise", () => require(folder + "imports-rejected-promise.mjs"));
say("promise-never-settled", () => require(folder + "promise-never-settled.mjs"));
say("imports-promise-never-settled", () => require(folder + "imports-promise-never-settled.mjs"));
