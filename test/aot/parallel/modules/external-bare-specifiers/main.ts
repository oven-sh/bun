// A bare specifier marked external means that package and nothing else: no `node:` prefix is added or removed to find a module.
// Flags: --external test --external sqlite
import { label } from "test";
import nodeTest from "node:test";

console.log("package:", label);
console.log("node:test:", typeof nodeTest);

try {
  // @ts-ignore
  await import("sqlite");
  console.log("sqlite loaded");
} catch (error) {
  console.log("sqlite:", (error as { code?: string }).code);
}
