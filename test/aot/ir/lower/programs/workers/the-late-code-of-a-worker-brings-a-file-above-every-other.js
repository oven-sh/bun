// The code of the Worker holds the path of top/one/two/lib/starts.js, a file above the root of the executable, and a Worker starts by that text. How the path reads hangs on the highest file of the program,
// and that code alone leads to top/one/job.js, one folder further up, and through it to top/up.js. The build follows the code as it would read if the folders went up past the root of the disk, finds both,
// and keeps the code as it reads at the depth that they say: four. No other text of it is in the program. A `..` from top/one/job.js stays in the folders of the executable.
// ENTRY: top/one/two/app/main.js
// CWD: top/one/two/app
// RUN(TEXT): link
// TEXT: module {{*}} path="data:text/javascript,import(%22%2F%24bunfs%2F_.._%2F_.._%2F_.._%2F_.._%2Flib%2F..%2F..%2Fjob.js%22)"
// RUN(ONE): link
// ONE: path="data:text/javascript
// ONE-NOT: path="data:text/javascript
// RUN(JOB): link
// JOB: module {{*}} path="/$bunfs/_.._/_.._/_.._/job.js"
// RUN(HIGHEST): link
// HIGHEST: module {{*}} path="/$bunfs/_.._/_.._/up.js"
// RUN(NEAREST): link
// NEAREST: module {{*}} path="/$bunfs/_.._/_.._/_.._/_.._/up.js"

// FILE: top/one/two/app/main.js
import "../lib/starts.js";
new Worker(new URL("../up.js", import.meta.url));

// FILE: top/one/two/lib/starts.js
new Worker("data:text/javascript," + encodeURIComponent('import("' + import.meta.dirname + '/../../job.js")'));

// FILE: top/one/job.js
new Worker(new URL("../up.js", import.meta.url));

// FILE: top/one/two/up.js
postMessage("top/one/two/up.js");

// FILE: top/up.js
postMessage("top/up.js");
