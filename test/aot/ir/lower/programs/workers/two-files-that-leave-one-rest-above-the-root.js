// Two files of one name lie two and three folders above the entry point. In an executable `..` leaves /job.js of both paths, so the run cannot tell them apart: the build says so.
// DIAGNOSTIC: TS100086 1
// ENTRY: one/two/app/main.js
// CWD: one/two/app
// RUN(TWO): link
// TWO: module {{*}} path="/$bunfs/_.._/_.._/_.._/job.js"
// RUN(THREE): link
// THREE: module {{*}} path="/$bunfs/_.._/_.._/job.js"

// FILE: one/two/app/main.js
new Worker(new URL("../../job.js", import.meta.url).href);
new Worker(new URL("../../../job.js", import.meta.url).href);

// FILE: one/job.js
postMessage("two folders up");

// FILE: job.js
postMessage("three folders up");
