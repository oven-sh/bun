// Flags: --packages=external
// Reference: bun build --compile
import { other } from "~lib/other";
import { tool } from "~tools";
console.log(tool, other);
try {
  require("@made-up/not-there");
} catch (error) {
  console.log((error as { code: string }).code);
}
