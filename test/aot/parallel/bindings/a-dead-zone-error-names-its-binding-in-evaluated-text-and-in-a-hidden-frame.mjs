// The message of a read or a write in a dead zone names the binding: in a function made from text at run time, which the interpreter runs inside the executable, in a class field initializer, and in the parameter default of an async function that compiled code calls.
// Env: BUN_JSC_showPrivateScriptsInStackTraces=0
const said = [];
function tell(what, run) {
    try {
        const result = run();
        if (result instanceof Promise) return result.then(() => said.push(what + ": fulfilled"), error => said.push(what + ": " + error.name + ": " + error.message));
        said.push(what + ": no error");
    } catch (error) {
        said.push(what + ": " + error.name + ": " + error.message);
    }
}
const make = text => new Function("return " + text)();

tell("text, read", make("function () { x; let x; }"));
tell("text, postfix increment", make("function () { x++; let x; }"));
tell("text, prefix decrement", make("function () { --x; let x; }"));
tell("text, compound assignment", make("function () { x += 1; let x; }"));
tell("text, logical assignment", make("function () { x ??= 1; let x; }"));
tell("text, array pattern", make("function () { [x] = [1]; let x; }"));
tell("text, object pattern", make("function () { ({ x } = {}); let x; }"));
tell("text, tagged template", make("function () { x`a`; let x; }"));
tell("text, captured read", make("function () { const read = () => value; return read(); let value = 1; }"));
tell("text, captured write", make("function () { (() => { value++; })(); let value = 1; }"));
tell("text, field initializer", make("function () { class X { name = foo } new X(); const foo = 1; }"));
tell("text, field initializer of a derived class", make("function () { class B {} class X extends B { name = foo } new X(); const foo = 1; }"));
tell("text, static field initializer", make("function () { class X { static name = foo } const foo = 1; }"));
await tell("text, parameter default of an async function", make("async function (a = b, b) { await null; }"));
await tell("text, parameter default of an async arrow function", make("async (a = b, b) => { await null; }"));

tell("written, postfix increment", function () { y++; let y; });
tell("written, compound assignment", function () { y += 1; let y; });
tell("written, array pattern", function () { [y] = [1]; let y; });
tell("written, field initializer", function () { class X { name = foo } new X(); const foo = 1; });
tell("written, static field initializer", function () { class X { static name = foo } const foo = 1; });
await tell("written, parameter default of an async function", async function (a = b, b) { await null; });

// A timer calls the function made from text with nothing of this program on the stack.
await new Promise(resolve => {
    process.once("unhandledRejection", error => { said.push("text, called by a timer: " + error.name + ": " + error.message); resolve(); });
    setTimeout(make("async function (late = late) { await null; }"), 0);
});
console.log(said.join("\n"));
