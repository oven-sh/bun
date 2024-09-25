import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export function css(file: string, is_development: boolean): string {
  const contents = readFileSync(resolve(import.meta.dir, file), "utf-8");
  if (!is_development) {
    // TODO: minify
    return contents;
  }
  return contents;
}
