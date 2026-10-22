// `import`, `export` and `new.target` outside the positions JavaScript allows are EarlyError. `import a = require()` is TypeScript syntax, so its position error is TypeScriptGrammar.
{ import "a"; }
function f() { export {}; }
new.target;
{ import a = require("a"); }
export {};
