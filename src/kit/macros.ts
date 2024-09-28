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

export function int(char: string): number {
  if(char.length !== 1) throw new Error('Must be one char long');
  return char.charCodeAt(0);
}