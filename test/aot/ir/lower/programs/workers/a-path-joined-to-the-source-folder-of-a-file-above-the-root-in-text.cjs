// The code of a Worker holds a path that path.join() makes of __dirname, in a file above the root of the executable. __dirname is the folder of the source: the build knows it, puts the text together and compiles it.
// To join, it has to know the separator of the run, which the target says, and not the path of the file in the executable, which is not known while the load runs.
// ENTRY: one/app/main.cjs
// CWD: one/app
// RUN(TEXT): link
// TEXT: module {{*}} path="blob:

// FILE: one/app/main.cjs
require("../lib/starts.cjs");

// FILE: one/lib/starts.cjs
const path = require("node:path");
new Worker('require("' + path.join(__dirname, "job.cjs") + '")', { eval: true });

// FILE: one/lib/job.cjs
exports.said = "one/lib/job.cjs";
