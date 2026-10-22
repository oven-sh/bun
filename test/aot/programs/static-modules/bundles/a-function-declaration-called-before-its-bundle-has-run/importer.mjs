import "./first.mjs";
import { run } from "./bundle.mjs";
export function early() {
  return run(1);
}
console.log("importer", early());
