// The code of a Worker holds the path of the file that starts it, and that file lies above the root of the executable. Where such a file lies in the executable hangs on the highest file of the program,
// which is not known while the load runs: the build does not put the text together. No text of the image hangs on how deep the folder of the build lies on disk.
// ENTRY: one/app/main.js
// CWD: one/app
// RUN(TEXT): link
// TEXT-NOT: path="data:text/javascript
// TEXT: module {{*}} path="/$bunfs/_.._/_.._/lib/starts.js"
// TEXT-NOT: path="data:text/javascript

// FILE: one/app/main.js
import "../lib/starts.js";

// FILE: one/lib/starts.js
const file = import.meta.dirname + "/job.js";
new Worker("data:text/javascript," + encodeURIComponent('import("' + file + '")'));

// FILE: one/lib/job.js
export const said = "one/lib/job.js";
