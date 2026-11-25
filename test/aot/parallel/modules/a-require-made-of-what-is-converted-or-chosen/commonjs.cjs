const { show } = require("./show.cjs");
const other = process.argv.length > 90 ? __dirname + "/other/x.cjs" : "";
show("file:// before href", () => require("module").createRequire("file://" + new URL("file:" + __filename).href)("./a.cjs").name);
show("http://", () => require("module").createRequire("http://" + __filename)("./a.cjs").name);
show("name and text", () => require("module").createRequire(__filename + "file:")("./a.cjs").name);
show("href of a text", () => require("module").createRequire(__filename.href)("./a.cjs").name);
show("falsy or own", () => require("module").createRequire(other || __filename)("./a.cjs").name);
