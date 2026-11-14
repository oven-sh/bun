// A text that the program evaluates runs as it stands.
const made = new Function("const made = () => 1; return made");
const Made = new Function("const Made = class {}; return Made;");
console.log(made().name, Made().name);
console.log((0, eval)("(function () { let made = async () => 1; return made; })")().name);
console.log(eval("(() => { const Made = class {}; return Made; })()").name);
console.log(JSON.stringify((0, eval)("var zz = null ?? (() => 1); zz.name")));
console.log(JSON.stringify(new Function("const a = true && function () {}; const b = 1 ? class {} : 0; return [a.name, b.name]")()));
// In a file it is written in the place of its only use.
function returned() { const made = () => 1; return made; }
console.log(JSON.stringify(returned().name));
