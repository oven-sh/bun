// Reference: bun build --compile
function neverUsed() { return 0; }
const pages = import.meta.glob("./pages/*.cjs", { eager: true });
exports.count = Object.keys(pages).length;
console.log(exports.count, pages["./pages/a.cjs"].title);
