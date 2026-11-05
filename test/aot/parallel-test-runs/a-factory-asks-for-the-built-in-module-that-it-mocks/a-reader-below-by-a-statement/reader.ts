import { basename, extname } from "node:path";
export function read(path: string) { return basename(path) + " " + extname(path); }
