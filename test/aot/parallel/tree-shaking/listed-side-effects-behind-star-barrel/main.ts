// package.json lists the files that have side effects. A listed file runs when the barrel that imports it passes a used name on by `export *`, though the barrel itself is not listed and is left out.
import { version } from "./barrel1";
import { imported } from "import-for-effect";
import { nested } from "two-barrels";
console.log(version, imported, nested);
console.log((globalThis as any).ran.join(" "));
