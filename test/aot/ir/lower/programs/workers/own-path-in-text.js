// The code of each Worker holds the path of a file as the program sees it when it runs. The build puts the text together, compiles it, and finds the file on disk.
// RUN(PATH): link
// PATH: module [[text]] path="data:text/javascript,import(%22%2F%24bunfs%2Froot%2Flib%2Fby-path.js%22)"
// RUN(HREF): link
// HREF: module [[text]] path="data:text/javascript,import(%22file%3A%2F%2F%2F%24bunfs%2Froot%2Flib%2F%257Eodd%2Fby-url.js%22)"
// RUN(BLOB): link
// BLOB: module [[text]] path="blob:
// RUN(IMPORTED): link
// IMPORTED: module [[imported]] path="/$bunfs/root/lib/by-path.js"
// RUN(UNDERBLOB): link
// UNDERBLOB: module [[imported]] path="/$bunfs/root/lib/by-blob.js"
// RUN(UNKNOWN): link
// UNKNOWN-NOT: path="data:text/javascript,postMessage

// FILE: main.js
import "./lib/starts.js";
import "./lib/~odd/starts.js";

// FILE: lib/starts.js
const file = import.meta.dir + "/by-path.js";
export const start = () => new Worker("data:text/javascript," + encodeURIComponent('import("' + file + '")'));
const url = URL.createObjectURL(new Blob([`import("${import.meta.dirname}/by-blob.js")`], { type: "application/javascript" }));
new Worker(url);
new Worker("data:text/javascript," + encodeURIComponent('postMessage("' + file + process.argv[2] + '")'));

// FILE: lib/~odd/starts.js
const url = new URL("./by-url.js", import.meta.url).href;
new Worker("data:text/javascript," + encodeURIComponent('import("' + url + '")'));

// FILE: lib/by-path.js
export const name = "by-path";

// FILE: lib/by-blob.js
export const name = "by-blob";

// FILE: lib/~odd/by-url.js
export const name = "by-url";
