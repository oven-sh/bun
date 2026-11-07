// plain.cjs says nothing of CommonJS in its text. The require in real.cjs, which runs while the statements are followed, may be the first to read it, so it is compiled as CommonJS.
// To the loader behind `import` it is an ES module and has its turn among the modules. The list of the root says so by not hoisting it; the loader of the run time goes by no list, and reads the record of the file.
// No other record says it: not that of real.cjs, which is CommonJS by its text.
// RUN(PLAIN): link
// PLAIN-NOT: IsModuleToImports
// PLAIN: module {{*}}path="{{*}}/plain.cjs"{{*}} kind=CommonJs flags=[{{*}}IsModuleToImports
// PLAIN-NOT: IsModuleToImports
// RUN(ROOT): link
// ROOT: module {{*}}path="{{*}}/main.mjs"{{*}} requests=[{target=m{{*}} isHoisted=true}, {target=m{{*}} completes=true}, {target=m{{*}} completes=true}]

// FILE: main.mjs
import "./real.cjs";
import "./plain.cjs";

// FILE: real.cjs
exports.load = () => require("./plain.cjs");

// FILE: plain.cjs
globalThis.seen = true;
