// Dynamic `import()` of a CommonJS module that exports a function named `then`.
function show(label, v) { console.log(label + ": " + v); }
show("then is a function", (await import("./files/d1.cjs")).a);
{ const { a } = await import("./files/d1.cjs"); show("a pattern", a); }
show("control: then is a number", (await import("./files/d2.cjs")).a);
show("control: no then", (await import("./files/d3.cjs")).a);
show("then by a getter", (await import("./files/d4.cjs")).a);
show("then by a star", (await import("./files/d5.cjs")).a);
show("then by module.exports = { .. }", (await import("./files/d6.cjs")).a);
