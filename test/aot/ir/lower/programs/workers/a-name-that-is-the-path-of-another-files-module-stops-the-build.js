// one/jobs/job.js lies one folder above the entry point, in /$bunfs/root/_.._/jobs in the executable, and starts a Worker from helper.js two folders above itself: the `..` that should go up takes the `_.._` back,
// and its URL says /$bunfs/root/helper.js. The program has a helper.js beside the entry point, whose module has that path: the wrong file would start. The build stops.
// DIAGNOSTIC: TS100087 1
// ENTRY: one/app/main.js
// CWD: one/app
// RUN: link

// FILE: one/app/main.js
new Worker(new URL("../jobs/job.js", import.meta.url));
new Worker(new URL("./helper.js", import.meta.url));

// FILE: one/app/helper.js
postMessage("beside the entry point");

// FILE: one/jobs/job.js
new Worker(new URL("../../helper.js", import.meta.url));

// FILE: helper.js
postMessage("two folders above the job");
