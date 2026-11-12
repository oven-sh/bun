import "./early";
import path, { join } from "node:path";
import fs, { existsSync } from "node:fs";
export function paths(): string {
  return path.join("a", "b") + join("c", "d");
}
export function isFolder(): boolean {
  return fs.statSync(".").isDirectory() && existsSync(".");
}
console.log("main", paths(), isFolder());
