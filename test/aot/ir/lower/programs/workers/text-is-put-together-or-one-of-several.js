// The text that a Worker starts from holds what node:path, node:url and String.raw make of the path of the file, or `__dirname`, and it may be one of several texts. The build compiles each: the file that a text imports is in the program for no other reason.
// RUN(TOPATH): link
// TOPATH: module [[text]] path="data:text/javascript,postMessage('%2F%24bunfs%2Froot%2Flib%2Fstarts.js')"
// RUN(JOINED): link
// JOINED: module [[imported]] path="/$bunfs/root/lib/joined.js"
// RUN(FOLDER): link
// FOLDER: module [[imported]] path="/$bunfs/root/lib/in-folder.js"
// RUN(RAW): link
// RAW: module [[imported]] path="/$bunfs/root/lib/raw.js"
// RUN(FIRST): link
// FIRST: module [[imported]] path="/$bunfs/root/lib/first.js"
// RUN(SECOND): link
// SECOND: module [[imported]] path="/$bunfs/root/lib/second.js"
// RUN(PASSED): link
// PASSED: module [[imported]] path="/$bunfs/root/lib/passed.js"
// RUN(PART): link
// PART: module [[imported]] path="/$bunfs/root/lib/part.js"
// RUN(SOURCE): link
// SOURCE: module [[text]] path="data:text/javascript,import(%22{{*}}%2Flib%2Fby-source.js%22)"
// RUN(OTHERJOIN): link
// OTHERJOIN-NOT: path="/$bunfs/root/lib/not-joined.js"

// FILE: main.js
import "./lib/starts.js";
import "./lib/common.cjs";

// FILE: lib/starts.js
import path, { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker as NodeWorker } from "node:worker_threads";
new Worker("data:text/javascript," + encodeURIComponent("postMessage('" + fileURLToPath(import.meta.url) + "')"));
new Worker("data:text/javascript," + encodeURIComponent('import("' + path.join(import.meta.dir, "a", "..", "joined.js") + '")'));
new Worker("data:text/javascript," + encodeURIComponent('import("' + dirname(fileURLToPath(import.meta.url)) + path.sep + 'in-folder.js")'));
new Worker("data:text/javascript," + encodeURIComponent(String.raw`import("${import.meta.dir}/raw.js")`));
new NodeWorker(process.argv.length > 9 ? 'import("' + import.meta.dir + '/first.js")' : 'import("' + import.meta.dir + '/second.js")', { eval: true });
const evaluate = text => new NodeWorker(text, { eval: true });
evaluate('import("' + import.meta.dir + '/passed.js")');
const start = code => new Worker(URL.createObjectURL(new Blob([code])));
start('import("' + import.meta.dir + '/part.js")');
const join = (...parts) => parts.join("/");
new Worker("data:text/javascript," + encodeURIComponent('import("' + join(import.meta.dir, "not-joined.js") + '")'));

// FILE: lib/common.cjs
new Worker("data:text/javascript," + encodeURIComponent('import("' + __dirname + '/by-source.js")'));

// FILE: lib/joined.js
export const name = "joined";

// FILE: lib/in-folder.js
export const name = "in-folder";

// FILE: lib/raw.js
export const name = "raw";

// FILE: lib/first.js
export const name = "first";

// FILE: lib/second.js
export const name = "second";

// FILE: lib/passed.js
export const name = "passed";

// FILE: lib/part.js
export const name = "part";

// FILE: lib/by-source.js
export const name = "by-source";

// FILE: lib/not-joined.js
export const name = "not-joined";
