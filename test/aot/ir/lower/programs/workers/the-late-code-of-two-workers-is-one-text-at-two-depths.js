// Two files of one name start a Worker from the same code, which holds the path of the file: top/one/two/lib/starts.js, one folder above the entry point's, and top/one/lib/starts.js, two folders above it.
// Only the code of the first leads to the second. At depth two, which the files say before that code is followed, the code of the first is the very text that the code of the second is at depth three.
// The program holds what reads at its own depth alone: the two texts of depth three, each once.
// ENTRY: top/one/two/app/main.js
// CWD: top/one/two/app
// RUN(NEAR): link
// NEAR: module {{*}} path="data:text/javascript,import(%22%2F%24bunfs%2F_.._%2F_.._%2F_.._%2Flib%2Fjob.js%22)"
// RUN(FAR): link
// FAR: module {{*}} path="data:text/javascript,import(%22%2F%24bunfs%2F_.._%2F_.._%2Flib%2Fjob.js%22)"
// RUN(TWO): link
// TWO: path="data:text/javascript
// TWO: path="data:text/javascript
// TWO-NOT: path="data:text/javascript

// FILE: top/one/two/app/main.js
import "../lib/starts.js";

// FILE: top/one/two/lib/starts.js
new Worker("data:text/javascript," + encodeURIComponent('import("' + import.meta.dirname + '/job.js")'));

// FILE: top/one/two/lib/job.js
import "../../lib/starts.js";

// FILE: top/one/lib/starts.js
new Worker("data:text/javascript," + encodeURIComponent('import("' + import.meta.dirname + '/job.js")'));

// FILE: top/one/lib/job.js
export {};
