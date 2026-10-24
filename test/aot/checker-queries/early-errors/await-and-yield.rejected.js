// await and yield expressions outside of async and generator code or in parameters, and await and yield as names where they are reserved. The async arrow function is an argument, because bun run drops an unused one before JavaScriptCore reads it.
function f() { await 1; }
function f() { yield 1; }
function* g() { function f() { yield 1; } }
async function f() { function g() { await 1; } }
class C { static { await 1; } }
class C { a = await 1; }
function* g(a = yield) {}
async function f(a = await 1) {}
f(async (a = await 1) => 1);
async function f() { var await; }
function* g() { var yield; }
class C { static { var await; } }
() => { await 1; };
