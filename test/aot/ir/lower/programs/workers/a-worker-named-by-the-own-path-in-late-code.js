// The code of a Worker is put together late: it holds the path of one/lib/starts.js, a file above the root of the executable. It starts another Worker and names it by that path.
// The name is read by the depth that the code was put together for, as what the code imports is: one/lib/job.js is an entry point of the program.
// ENTRY: one/app/main.js
// CWD: one/app
// RUN(JOB): link
// JOB: module {{*}} path="/$bunfs/_.._/_.._/lib/job.js"

// FILE: one/app/main.js
import "../lib/starts.js";

// FILE: one/lib/starts.js
new Worker("data:text/javascript," + encodeURIComponent('new Worker("' + import.meta.dirname + '/job.js")'));

// FILE: one/lib/job.js
postMessage("one/lib/job.js");
