import { lazy } from "./table";
const found = await lazy["./modules/b.ts"]();
console.log(found.default, found.run(), new found.Tool().use(), JSON.stringify(new found.Tool(), ["kind"]));
