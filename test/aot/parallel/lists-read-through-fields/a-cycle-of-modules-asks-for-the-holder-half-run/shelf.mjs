import { sum } from "./reader.mjs";
class Shelf { constructor(rows) { this.rows = rows; } }
try { console.log("SAID early", sum(0)); } catch (error) { console.log("SAID early", error.name, error.message); }
export const shelf = new Shelf(JSON.parse(process.argv[2] ?? "[1,2,3]"));
console.log("SAID behind", sum(0));
