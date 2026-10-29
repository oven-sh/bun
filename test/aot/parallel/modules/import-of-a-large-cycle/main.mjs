// import() of a module whose graph goes round a cycle of 72 modules. A walk over such a graph visits every module of the cycle, so the build has recorded what the walk finds to do: the CommonJS
// modules, which run when their importers are linked, and the module that has to look for the names of an `export *`. The imports that follow reach the same cycle, which is linked by then.
// (In which order several CommonJS modules of one link run is the loader's business: they are shown sorted.)
globalThis.ran = [];
const isPlainLeaf = (name) => /^leaf-[a-z0-9]+$/.test(name);
function show() {
    console.log(ran.filter(isPlainLeaf).sort().join(" "), "|", ran.filter((name) => !isPlainLeaf(name)).join(" "));
    ran.length = 0;
}
const root = await import("./root.mjs");
show();
console.log(root.describe());
const member = await import("./ring/m30.mjs");
show();
console.log(Object.keys(member).join());
const late = await import("./late.mjs");
show();
console.log(late.describe());
const inside = await member.importLater();
show();
console.log(inside.describe());
const star = await import("./ring/m20.mjs");
show();
console.log(Object.keys(star).join(), star.starred, star.other);
