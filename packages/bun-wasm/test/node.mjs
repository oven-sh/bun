import { readFileSync } from "fs";
import { getTests, init } from "../index.mjs";

const filePath = process.argv[2];
if (!filePath) throw new Error("Usage: node node.mjs <file>");

const buf = readFileSync(filePath);
await init();

console.log(getTests(buf));
