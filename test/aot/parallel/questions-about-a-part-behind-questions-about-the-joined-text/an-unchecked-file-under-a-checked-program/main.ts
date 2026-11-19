const relation: (path: string, dir: string) => string = require("./inside.cjs");
const hide = (x: any): any => [x][JSON.parse("0")];
let seen = "";
for (let i = 0; i < 300; i++) seen = relation(hide("src2/a"), hide("src")) + "," + relation(hide("src/a"), hide("src")) + "," + relation(hide("lib/a"), hide("src"));
console.log(seen);
