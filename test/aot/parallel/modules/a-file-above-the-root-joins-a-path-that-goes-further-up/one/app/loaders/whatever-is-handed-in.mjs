import path from "node:path";
import "../../texts/en.json";
export const byWayFromHere = file => import(path.join(import.meta.dirname, path.relative(import.meta.dirname, file)));
export const resolved = file => import(path.resolve(import.meta.dirname, file));
