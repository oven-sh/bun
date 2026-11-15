const uses = { "./a.cjs": () => 1, "./b.cjs": () => 2 };
uses.setup?.();
const out = [];
for (const name of Object.keys(uses)) out.push(require(name).label);
console.log(out.join(" "), out.length + uses["./a.cjs"]());
