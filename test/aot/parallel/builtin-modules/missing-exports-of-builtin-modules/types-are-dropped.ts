import { readFileSync, PathLike } from "node:fs";
const path: PathLike = "x";
console.log("ran", typeof readFileSync, path);
