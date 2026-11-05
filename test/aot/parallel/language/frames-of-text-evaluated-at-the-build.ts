// A function made by `new Function` from constant text is compiled at the build. Its frame names the file that made it, with the line counted in the text, as in plain Bun. Columns are left out:
// the text has no source map in plain Bun, which puts a call in it behind its callee.
const show = (s: string | undefined) => String(s).split("\n").slice(1, 4).map(l => l.trim().replace(/^at /, "").replace(/\(?[^ ()]*[\\/]/, "(").replace(/:\d+\)?$/, "")).join(" | ");
function thrower(): never { throw new Error("x"); }
const made = new Function("callback", "const got = callback();\nreturn got;");
function calls() { try { return made(thrower); } catch (e) { return show((e as Error).stack); } }
console.log(calls());
