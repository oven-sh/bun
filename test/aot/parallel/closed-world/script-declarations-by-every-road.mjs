// closed-world/script-declarations-constant-globals by every road to a script of node:vm, and beside text that declares nothing here. A name that the global object lacks is looked up: compiled code sees what the script declared. A global that compiled code takes for a constant stays one where scripts run: the declaration is refused.
// Alone: what it prints hangs on what else the executable holds: which modules and members were compiled in, and whether anything evaluates text
import vm from "node:vm";
const say = (...words) => console.log(...words);
const tried = action => { try { return action(); } catch (error) { return error.name + ": " + String(error.message).split(":")[0]; } };
const key = JSON.parse('"runInThisContext"');
say("let, absent", tried(() => vm.runInThisContext("let absent1 = 1")), typeof absent1);
say("a Script, absent", tried(() => new vm.Script("class absent2 {}").runInThisContext()), typeof absent2);
say("var and function, absent", tried(() => vm.runInThisContext("var absent3 = 1; function absent4() { return 2; }")), typeof absent3, typeof absent4);
say("a computed key, absent", tried(() => new vm.Script("let absent5 = 1")[key]()), typeof absent5);
say("off the prototype, absent", tried(() => Reflect.apply(vm.Script.prototype.runInThisContext, new vm.Script("const absent6 = 1"), [])), typeof absent6);
say("out of a sandbox, absent", tried(() => vm.runInNewContext('this.constructor.constructor("return process")().getBuiltinModule("node:vm").runInThisContext("let absent7 = 1")', {})), typeof absent7);
say("a new context", vm.runInNewContext("let Response = 1, absent8 = 2; Response + absent8"), typeof Response, typeof absent8);
say("a context", new vm.Script("let Error = 1, absent9 = 2; Error + absent9").runInContext(vm.createContext({})), typeof Error, typeof absent9);
say("a sandbox with our global", vm.runInNewContext("ours.absent10 = 7", { ours: globalThis }), typeof absent10);
say("a function", vm.compileFunction("let URL = 1, absent11 = 2; return URL + absent11")(), typeof URL, typeof absent11);
say("let, a constant", tried(() => vm.runInThisContext("let Response = 1")), typeof Response, new Response("a").status);
say("class, a constant", tried(() => new vm.Script("class Error {}").runInThisContext()), typeof Error, new Error("a").message);
say("function, a constant", tried(() => vm.runInThisContext("function URL() {}")), new URL("http://host/path").pathname);
say("a computed key, a constant", tried(() => new vm.Script("const Buffer = 1")[key]()), Buffer.from("a").length);
/* Output:
let, absent undefined number
a Script, absent undefined function
var and function, absent undefined number function
a computed key, absent undefined number
off the prototype, absent undefined number
out of a sandbox, absent undefined number
a new context 3 function undefined
a context 3 function undefined
a sandbox with our global 7 number
a function 3 function undefined
let, a constant SyntaxError: Cannot declare 'Response' function 200
class, a constant SyntaxError: Cannot declare 'Error' function a
function, a constant TypeError: Cannot declare 'URL' /path
a computed key, a constant SyntaxError: Cannot declare 'Buffer' 1
*/
