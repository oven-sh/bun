// An import() of a module that is running, and that is not the one that was asked for first, settles when the module has run, as in Node.js and `bun build --compile`.
// In `bun run` the promise stays pending. Behind the jobs that the files queue, ahead of timers; in which job differs: Node.js later, `bun build --compile` one job sooner.
globalThis.say = line => console.log(line);
setTimeout(() => say("a timer"), 0);
setImmediate(() => say("an immediate"));
Promise.resolve().then(() => say("a job of main, queued first"));
say("main starts");
require("./top.mjs");
say("main goes on");
Promise.resolve().then(() => say("a job of main, queued last"));
process.nextTick(() => say("a tick"));
say("main ends");
/* Output:
main starts
a runs
mid starts
b starts
b ends
mid ends
top runs
main goes on
main ends
a tick
a job of main, queued first
a job of b, ahead of the call
a job of b, behind the call
a job of mid
a job of top
a job of main, queued last
its second
the import is in: late
its third
its fourth
its fifth
an immediate
a timer
*/
