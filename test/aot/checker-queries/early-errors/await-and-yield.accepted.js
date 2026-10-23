// await at the top level of a module and in async functions, yield in generators.
await 1;
async function f() { await 1; }
function* g() { yield 1; }
async () => { await 1; };
async function* g() { yield await 1; }
class C { async m() { await 1; } }
class C { static { (async () => { await 1; })(); } }
function* g() { yield; }
