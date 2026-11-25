// Reference: bun build --compile
function neverUsed() { return 0; }
const titles = import.meta.glob("./pages/*.cjs", { eager: true, import: "title" });
console.log(JSON.stringify(titles));
