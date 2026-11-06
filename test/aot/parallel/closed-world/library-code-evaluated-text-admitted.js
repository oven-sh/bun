// closed-world/library-code-from-evaluated-text-refused built with --compile-inspector. A debugger can name any built-in, so such a build leaves out the code of none: the text uses every built-in as in plain Bun.
// Text that is decoded at run time is unknown to the compiler.
// Flags: --compile-inspector
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
