// Prints what `using` declarations and disposable stacks throw, with the frames: the steps that look for the method of a resource are in no stack trace, and a function that a built-in has made stands where it does in the text of the built-in.
const frames = error => String(error && error.stack).split("\n").slice(1, 7).map(line => line.trim().replace(/^at /, "").replace(/\(?[^ (]*\.mjs:/, "(").replace(/^\((\d+:\d+)$/, "($1)")).join(" < ");
const describe = error => (error && error.constructor.name) + " " + JSON.stringify(error && error.message) + " " + frames(error) + (error instanceof SuppressedError ? " | error: " + describe(error.error) + " | suppressed: " + describe(error.suppressed) : "");
async function attempt(run) { try { const result = await run(); console.log(run.name + ": nothing " + typeof result); } catch (error) { console.log(run.name + ": " + describe(error)); } }
const hide = value => [value, 0][Number(process.argv.length > 100)];
function fail(text = "thrown") { throw new Error(text); }
const throwsOnDispose = () => ({ [Symbol.dispose]() { fail("disposed"); } });
const throwsOnAsyncDispose = () => ({ async [Symbol.asyncDispose]() { await 1; fail("disposed"); } });
const quiet = () => ({ [Symbol.dispose]() {} });
await attempt(function disposeThrows() { using a = throwsOnDispose(); hide(a); });
await attempt(function bodyThrows() { using a = quiet(); fail(); });
await attempt(function bothThrow() { using a = throwsOnDispose(); fail("body"); });
await attempt(function twoDisposesThrow() { using a = throwsOnDispose(), b = throwsOnDispose(); hide(a, b); });
await attempt(function initializerThrows() { using a = fail(); hide(a); });
await attempt(function secondInitializerThrows() { using a = throwsOnDispose(); using b = fail("second"); hide(a, b); });
await attempt(function notDisposable() { using a = {}; hide(a); });
await attempt(function notAnObject() { using a = 5; hide(a); });
await attempt(function nullValue() { using a = null; return hide(a); });
await attempt(function disposeIsNoFunction() { using a = { [Symbol.dispose]: 5 }; hide(a); });
await attempt(function inBlock() { { using a = throwsOnDispose(); hide(a); } return 1; });
await attempt(function inLoop() { for (using a of [throwsOnDispose()]) hide(a); });
await attempt(function inForHead() { for (using a = throwsOnDispose(); hide(false); ) hide(a); });
await attempt(function returnsCall() { using a = quiet(); return fail(); });
await attempt(async function asyncDisposeThrows() { await using a = throwsOnAsyncDispose(); hide(a); });
await attempt(async function asyncBodyThrows() { await using a = { async [Symbol.asyncDispose]() {} }; fail(); });
await attempt(async function asyncBothThrow() { await using a = throwsOnAsyncDispose(); fail("body"); });
await attempt(async function asyncFallsBack() { await using a = throwsOnDispose(); hide(a); });
await attempt(async function asyncNotDisposable() { await using a = {}; hide(a); });
await attempt(function stack() { const stack = new DisposableStack(); stack.defer(() => fail("deferred")); stack.dispose(); });
await attempt(function stackUse() { const stack = new DisposableStack(); stack.use(throwsOnDispose()); stack.dispose(); });
await attempt(function stackAdopt() { const stack = new DisposableStack(); stack.adopt(1, () => fail("adopted")); stack.dispose(); });
await attempt(function stackUsing() { using stack = new DisposableStack(); stack.defer(() => fail("deferred")); });
await attempt(function stackDisposed() { const stack = new DisposableStack(); stack.dispose(); stack.defer(() => {}); });
await attempt(function stackUseObject() { new DisposableStack().use({}); });
await attempt(function stackUseNumber() { new DisposableStack().use(5); });
await attempt(function stackAdoptNumber() { new DisposableStack().adopt(1, 5); });
await attempt(function stackDeferNumber() { new DisposableStack().defer(5); });
await attempt(function asyncStackUseObject() { new AsyncDisposableStack().use({}); });
