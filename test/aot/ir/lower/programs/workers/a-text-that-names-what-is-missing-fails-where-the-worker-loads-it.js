// A Worker starts from a text that the build knows, and a statement of the text imports what is not there. `bun build` puts no such text into a bundle: the loader judges it where the
// Worker loads it, and whoever started the Worker hears of it. So the build goes on and warns, and the body of the text throws what the loader says.
// The load begins at the text, so it counted as loaded at start, and the build stopped.
// DIAGNOSTIC: TS100150 2
// RUN(TEXT): link
// TEXT: module [[text]] path="data:text/javascript,import './no-such-file.js'; postMessage(1)"
// TEXT: modulefailure {{*}} importer=[[text]] specifier="./no-such-file.js" endsLoadOf=[[text]]
// RUN(THROUGH): link
// THROUGH: module [[file]] path="/$bunfs/root/imports-what-is-missing.js"
// THROUGH: module [[text]] path="data:text/javascript,import './imports-what-is-missing.js'; postMessage(2)"
// THROUGH: modulefailure {{*}} importer=[[file]] specifier="./no-such-file.js" endsLoadOf=[[text]]

// FILE: main.js
new Worker("data:text/javascript,import './no-such-file.js'; postMessage(1)");
new Worker("data:text/javascript,import './imports-what-is-missing.js'; postMessage(2)");

// FILE: imports-what-is-missing.js
import "./no-such-file.js";
