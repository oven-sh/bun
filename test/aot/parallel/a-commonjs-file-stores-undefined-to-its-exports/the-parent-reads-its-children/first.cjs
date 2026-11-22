let work = 0;
for (let i = 0; i < 2; i++) work = (work + i) | 0;
require("./quiet.cjs");
console.log("main", work, module.children.length, typeof module.children[0]?.exports, module.children[0]?.loaded);
