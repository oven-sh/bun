// A program that evaluates text where the compiler sees it keeps eval. Much of what process, console, Bun and Buffer offer is written in JavaScript, and the executable holds the part of it that the program uses. The compiler does not know what the text will name, so a built-in whose code was left out reads as a function of its name, and only a call of that function throws. The error names the built-in and what to do. Where the built-in is an object in plain Bun, a call of one of its methods finds nothing to call, and that error goes on with the same sentence. The name itself stays, and the program goes on.
// Text that is decoded at run time is unknown to the compiler.
// Alone: what it prints depends on what else the executable holds: which modules and members were compiled in, and whether anything evaluates text
const decoded = text => Buffer.from(text).toString();
function outcome(error) {
  const message = String(error.message);
  return message.includes("bun compile differs from bun run here") ? "refused: " + message : error.name;
}
function attempt(text) {
  try { console.log(text + ": " + (0, eval)(decoded(text))); } catch (error) { console.log(text + ": " + outcome(error)); }
}
const refusedMembersOf = "(object => Reflect.ownKeys(object).filter(key => { try { object[key]; return false; } catch { return true; } }).map(String).sort().join())";

attempt("typeof process.stdout.write");
attempt("typeof process.stderr.write");
attempt("typeof process.stdin.on");
attempt("typeof process.stdout.isTTY");
attempt("typeof process.stdout._writableState");
attempt("typeof console._stdout.write");
attempt("typeof console._stderr.write");
attempt("typeof process.openStdin().pause().on");
attempt("new console.Console(process.stdout).log.name");
attempt("typeof console.Console");
attempt(refusedMembersOf + "(process)");
attempt(refusedMembersOf + "(console)");
attempt(refusedMembersOf + "(Bun)");
attempt("typeof process.finalization.register");
attempt("typeof process.allowedNodeEnvironmentFlags.has");
attempt("typeof process.loadEnvFile");
attempt("process.loadEnvFile('/nothing-there')");
attempt("typeof Bun.$");
attempt("typeof Bun.sql");
attempt("typeof Bun.SQL");
attempt("typeof Bun.peek");
attempt("Bun.peek(1)");
attempt("typeof new Bun.Glob('*').scanSync");
attempt("new Bun.Glob('*').scanSync('/nothing-there')");
attempt("typeof Object.getOwnPropertyDescriptor(Buffer.prototype, 'parent').get");
attempt("Buffer.alloc(1).parent.byteLength > 0");
attempt("Buffer.alloc(1).offset >= 0");
attempt("JSON.stringify(Buffer.alloc(1))");
attempt("typeof console.write");
attempt("console.write('')");
attempt("typeof process.stdout.write");
attempt("process.pid > 0 && typeof process.cwd() + typeof Bun.version + typeof console.log");
console.log("the program goes on");
/* Output:
typeof process.stdout.write: undefined
typeof process.stderr.write: undefined
typeof process.stdin.on: undefined
typeof process.stdout.isTTY: undefined
typeof process.stdout._writableState: undefined
typeof console._stdout.write: undefined
typeof console._stderr.write: undefined
typeof process.openStdin().pause().on: refused: process.openStdin().pause is not a function. (In 'process.openStdin().pause()', 'process.openStdin().pause' is undefined). None of process.openStdin or process.stdin was compiled into this executable because your code never uses them. To keep them, use one of them somewhere in your code. (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)
new console.Console(process.stdout).log.name: refused: console.Console was not compiled into this executable because your code never uses it. To keep it, use it somewhere in your code. (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)
typeof console.Console: function
(object => Reflect.ownKeys(object).filter(key => { try { object[key]; return false; } catch { return true; } }).map(String).sort().join())(process): 
(object => Reflect.ownKeys(object).filter(key => { try { object[key]; return false; } catch { return true; } }).map(String).sort().join())(console): 
(object => Reflect.ownKeys(object).filter(key => { try { object[key]; return false; } catch { return true; } }).map(String).sort().join())(Bun): 
typeof process.finalization.register: undefined
typeof process.allowedNodeEnvironmentFlags.has: undefined
typeof process.loadEnvFile: function
process.loadEnvFile('/nothing-there'): refused: process.loadEnvFile was not compiled into this executable because your code never uses it. To keep it, use it somewhere in your code. (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)
typeof Bun.$: function
typeof Bun.sql: function
typeof Bun.SQL: function
typeof Bun.peek: function
Bun.peek(1): refused: Bun.peek was not compiled into this executable because your code never uses it. To keep it, use it somewhere in your code. (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)
typeof new Bun.Glob('*').scanSync: function
new Bun.Glob('*').scanSync('/nothing-there'): Error
typeof Object.getOwnPropertyDescriptor(Buffer.prototype, 'parent').get: function
Buffer.alloc(1).parent.byteLength > 0: true
Buffer.alloc(1).offset >= 0: true
JSON.stringify(Buffer.alloc(1)): {"type":"Buffer","data":[0]}
typeof console.write: function
console.write(''): refused: console.write was not compiled into this executable because your code never uses it. To keep it, use it somewhere in your code. (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)
typeof process.stdout.write: undefined
process.pid > 0 && typeof process.cwd() + typeof Bun.version + typeof console.log: stringstringfunction
the program goes on
*/
