const { basename } = require("node:path");
const pages = import.meta.glob("./pages/*.js", { eager: true });
globalThis.listed = Object.keys(pages).map((key) => basename(key) + ":" + pages[key].name).join();
