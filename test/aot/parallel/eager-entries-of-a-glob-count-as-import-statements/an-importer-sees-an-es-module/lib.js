const { basename } = require("node:path");
const pages = import.meta.glob("./pages/*.cjs", { eager: true, import: "default" });
console.log(Object.keys(pages).map(key => basename(key) + ":" + pages[key].title).join());
