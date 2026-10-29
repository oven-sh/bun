// A script that runs in this realm declares no `let`, `const` or `class` under the name of a global that compiled code takes for a constant: every free name is looked up among those bindings first, so the declaration would replace the global. It is a SyntaxError, as `let undefined` is in the language, and the script declares nothing and does not run.
const vm = require("node:vm");
const print = console.log;
const realm = globalThis;
function attempt(label, action) {
  try { print(label + ": " + action()); } catch (error) { print(label + ": " + error.name + ": " + error.message); }
}
const ways = {
  "vm.runInThisContext": text => vm.runInThisContext(text),
  "vm.Script": text => new vm.Script(text).runInThisContext(),
};

realm.realmOfTheProgram = realm;
attempt("a name nobody has declared yet", () => typeof ofTheScript);
for (const way in ways) {
  const run = ways[way];
  attempt(way + ", let Math", () => run("let Math = { max: () => 'of the script' }; Math.max(1, 2)"));
  attempt(way + ", const JSON", () => run("const JSON = { stringify: () => 'of the script' }; JSON.stringify([1])"));
  attempt(way + ", class Map", () => run("class Map { get size() { return 'of the script'; } } new Map().size"));
  attempt(way + ", let Array in strict code", () => run("'use strict'; let Array = { isArray: () => 'of the script' }; Array.isArray([])"));
  attempt(way + ", let globalThis", () => run("let globalThis = 'of the script'; globalThis"));
  attempt(way + ", let undefined", () => run("let undefined = 'of the script'; undefined"));
  attempt(way + ", a second declaration and a statement beside it", () => run("realmOfTheProgram.didRun = true; let besideObject = 1, Object = 2;"));
}
attempt("nothing of a refused script was declared or run", () => [typeof besideObject, realm.didRun].join(" "));
attempt("compiled code sees the globals", () => [Math.max(1, 2), JSON.stringify([1]), new Map().size, Array.isArray([]), globalThis === realm, typeof Object.keys].join(" "));
attempt("so does a later script", () => vm.runInThisContext("[Math.max(1, 2), JSON.stringify([1]), new Map().size, Array.isArray([]), globalThis === realmOfTheProgram, typeof Object.keys].join(' ')"));

attempt("var Math in sloppy code", () => vm.runInThisContext("var Math = 'of the script'; typeof Math"));
attempt("var Math in strict code", () => vm.runInThisContext("'use strict'; var Math = 'of the script'; typeof Math"));
attempt("function Math", () => vm.runInThisContext("function Math() { } typeof Math"));
attempt("a store to globalThis.globalThis", () => vm.runInThisContext("'use strict'; globalThis.globalThis = 'of the script'; typeof globalThis"));
attempt("compiled code still sees the globals", () => [Math.max(1, 2), globalThis === realm].join(" "));

attempt("a block of a script", () => vm.runInThisContext("{ let Math = 'of the script'; class Map { } Math }"));
attempt("a function of a script", () => vm.runInThisContext("(function () { const JSON = 'of the script'; return JSON; })()"));
attempt("vm.compileFunction", () => vm.compileFunction("let Math = 'of the function'; return Math;")());
attempt("indirect eval", () => (0, eval)("let Math = 'of the text'; Math"));
attempt("Function", () => new Function("let Math = 'of the function'; return Math;")());
attempt("vm.runInNewContext", () => vm.runInNewContext("let Math = { max: () => 'of the context' }; class Map { } const globalThis = 1; Math.max(1, 2)"));
attempt("vm.runInContext", () => vm.runInContext("let JSON = 'of the context'; JSON", vm.createContext({})));
attempt("vm.Script in a new context", () => new vm.Script("class Array { } typeof Array").runInNewContext());

attempt("names that shadow nothing", () => vm.runInThisContext("let ofTheScript = 'of the script'; const alsoOfTheScript = 1; class ClassOfTheScript { } typeof ofTheScript"));
attempt("a later script sees them", () => new vm.Script("[ofTheScript, alsoOfTheScript, typeof ClassOfTheScript].join(' ')").runInThisContext());
attempt("compiled code sees them", () => [ofTheScript, alsoOfTheScript, typeof ClassOfTheScript].join(" "));
attempt("compiled code stores to them", () => { ofTheScript = "of the program"; return vm.runInThisContext("ofTheScript"); });
attempt("they are no properties of the global object", () => "ofTheScript" in realm);
attempt("a second declaration of one of them", () => vm.runInThisContext("let ofTheScript = 2"));
/* Output:
a name nobody has declared yet: undefined
vm.runInThisContext, let Math: SyntaxError: Cannot declare 'Math': compiled code treats the global 'Math' as a constant, so a script can't shadow it with a top-level let, const or class (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)
vm.runInThisContext, const JSON: SyntaxError: Cannot declare 'JSON': compiled code treats the global 'JSON' as a constant, so a script can't shadow it with a top-level let, const or class (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)
vm.runInThisContext, class Map: SyntaxError: Cannot declare 'Map': compiled code treats the global 'Map' as a constant, so a script can't shadow it with a top-level let, const or class (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)
vm.runInThisContext, let Array in strict code: SyntaxError: Cannot declare 'Array': compiled code treats the global 'Array' as a constant, so a script can't shadow it with a top-level let, const or class (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)
vm.runInThisContext, let globalThis: SyntaxError: Cannot declare 'globalThis': compiled code treats the global 'globalThis' as a constant, so a script can't shadow it with a top-level let, const or class (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)
vm.runInThisContext, let undefined: SyntaxError: Can't create duplicate variable that shadows a global property: 'undefined'
vm.runInThisContext, a second declaration and a statement beside it: SyntaxError: Cannot declare 'Object': compiled code treats the global 'Object' as a constant, so a script can't shadow it with a top-level let, const or class (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)
vm.Script, let Math: SyntaxError: Cannot declare 'Math': compiled code treats the global 'Math' as a constant, so a script can't shadow it with a top-level let, const or class (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)
vm.Script, const JSON: SyntaxError: Cannot declare 'JSON': compiled code treats the global 'JSON' as a constant, so a script can't shadow it with a top-level let, const or class (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)
vm.Script, class Map: SyntaxError: Cannot declare 'Map': compiled code treats the global 'Map' as a constant, so a script can't shadow it with a top-level let, const or class (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)
vm.Script, let Array in strict code: SyntaxError: Cannot declare 'Array': compiled code treats the global 'Array' as a constant, so a script can't shadow it with a top-level let, const or class (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)
vm.Script, let globalThis: SyntaxError: Cannot declare 'globalThis': compiled code treats the global 'globalThis' as a constant, so a script can't shadow it with a top-level let, const or class (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)
vm.Script, let undefined: SyntaxError: Can't create duplicate variable that shadows a global property: 'undefined'
vm.Script, a second declaration and a statement beside it: SyntaxError: Cannot declare 'Object': compiled code treats the global 'Object' as a constant, so a script can't shadow it with a top-level let, const or class (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)
nothing of a refused script was declared or run: undefined 
compiled code sees the globals: 2 [1] 0 true true function
so does a later script: 2 [1] 0 true true function
var Math in sloppy code: TypeError: Cannot assign to Math because built-in objects are read-only in a compiled executable (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)
var Math in strict code: TypeError: Cannot assign to Math because built-in objects are read-only in a compiled executable (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)
function Math: TypeError: Can't declare global function 'Math': property must be either configurable or both writable and enumerable
a store to globalThis.globalThis: TypeError: Cannot assign to globalThis because built-in objects are read-only in a compiled executable (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)
compiled code still sees the globals: 2 true
a block of a script: of the script
a function of a script: of the script
vm.compileFunction: of the function
indirect eval: of the text
Function: of the function
vm.runInNewContext: of the context
vm.runInContext: of the context
vm.Script in a new context: function
names that shadow nothing: string
a later script sees them: of the script 1 function
compiled code sees them: of the script 1 function
compiled code stores to them: of the program
they are no properties of the global object: false
a second declaration of one of them: SyntaxError: Can't create duplicate variable: 'ofTheScript'
*/
