import { describe } from "./middle.mjs";
import { existsSync } from "node:fs";
console.log(describe(), existsSync("/"));
