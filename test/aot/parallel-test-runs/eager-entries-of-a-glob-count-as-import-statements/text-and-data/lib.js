const { basename } = require("node:path");
const show = (label, table) => console.log(label, Object.keys(table).map(key => basename(key) + "=" + JSON.stringify(table[key])).join(" "));
show("text", import.meta.glob("./mods/*.txt", { eager: true, query: "?raw", import: "default" }));
show("data whole", import.meta.glob("./mods/*.json", { eager: true }));
show("data default", import.meta.glob("./mods/*.json", { eager: true, import: "default" }));
show("data name", import.meta.glob("./mods/*.json", { eager: true, import: "n" }));
