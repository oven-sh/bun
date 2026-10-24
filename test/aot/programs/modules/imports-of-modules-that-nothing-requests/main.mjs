// import() of modules whose graphs have cycles, share modules with each other, and end in CommonJS modules, which run when their importers are linked. One of the roots is requested by nothing,
// one lies on a cycle. Whichever graph is linked first and whatever is linked by then: every CommonJS module runs once, before the ES modules that import it, and the ES modules run in the order
// of their requests. (In which order several CommonJS modules of one link run is the loader's business: they are shown sorted.)
globalThis.ran = [];
const isPlainLeaf = (name) => /^leaf-[a-z]+$/.test(name);
function show() {
    console.log(ran.filter(isPlainLeaf).sort().join(" "), "|", ran.filter((name) => !isPlainLeaf(name)).join(" "));
    ran.length = 0;
}
const first = await import("./first.mjs");
show();
console.log(first.describe());
const second = await import("./second.mjs");
show();
console.log(second.describe());
const again = await import("./first.mjs");
console.log(again === first, ran.length);
const third = await import("./third.mjs");
show();
console.log(third.describe());
const onCycle = await import("./ring-a.mjs");
show();
console.log(onCycle.describe());
const otherOnCycle = await import("./ring-b.mjs");
show();
console.log(otherOnCycle.name, otherOnCycle.ten);
