// Statements in two files ask for one file as two types that share a place in the loader. The loader goes through the graph level by level, so the file nearer to the entry point decides, and among files of one level the one that is imported first.
import { early, nested } from "./first.mjs";
import { late, near } from "./second.mjs";
console.log("one level:", JSON.stringify(early), JSON.stringify(late));
console.log("two levels:", JSON.stringify(nested), JSON.stringify(near));
