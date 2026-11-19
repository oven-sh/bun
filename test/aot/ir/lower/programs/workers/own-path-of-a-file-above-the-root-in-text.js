// The code of a Worker holds the path of the file that starts it, and that file lies above the root of the executable. Where such a file lies in the executable hangs on the highest file of the program,
// which is not known while the file is read: the build puts the text together when nothing else is left to find, and compiles it. No text of the image hangs on how deep the folder of the build lies on disk.
// ENTRY: one/app/main.js
// CWD: one/app
// RUN(TEXT): link
// TEXT: module {{*}} path="data:text/javascript,import(%22%2F%24bunfs%2F_.._%2F_.._%2Flib%2Fjob.js%22)"
// RUN(ONE): link
// ONE: path="data:text/javascript
// ONE-NOT: path="data:text/javascript
// RUN(STARTS): link
// STARTS: module {{*}} path="/$bunfs/_.._/_.._/lib/starts.js"

// FILE: one/app/main.js
import "../lib/starts.js";

// FILE: one/lib/starts.js
const file = import.meta.dirname + "/job.js";
new Worker("data:text/javascript," + encodeURIComponent('import("' + file + '")'));

// FILE: one/lib/job.js
export const said = "one/lib/job.js";
