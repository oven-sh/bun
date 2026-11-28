import { nameOf } from "./main.mjs";
const early = nameOf("/a/b.txt");
console.log("b runs:", early);
export const describe = () => early + " " + nameOf("/e/f.md");
