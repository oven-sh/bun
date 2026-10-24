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
