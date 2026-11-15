// Reference: bun build --compile
function neverUsed() { return 0; }
const pages = import.meta.glob("./pages/*.cjs");
pages["./pages/a.cjs"]().then((page) => console.log(Object.keys(pages).length, page.title));
