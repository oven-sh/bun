import defer * as n from "./owner.ts";
const caught: unknown[] = [];
for (let i = 0; i < 2; i++) { try { console.log("X.C " + n.X.C); } catch (e) { caught.push(e); } }
console.log(caught.length, caught[0] === caught[1], (caught[0] as Error).message);
