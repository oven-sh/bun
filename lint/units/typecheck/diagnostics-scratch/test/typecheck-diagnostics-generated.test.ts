import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { generate } from "../../src/typecheck/scripts/generate-diagnostics.ts";

// The message table is generated from the two JSON files beside the generator; regenerate it (`bun src/typecheck/scripts/generate-diagnostics.ts`) when they or the generator change.
test("diagnostics_generated.rs is up to date", () => {
  const scripts = join(import.meta.dir, "../../src/typecheck/scripts");
  const expected = generate(
    readFileSync(join(scripts, "diagnosticMessages.json"), "utf8"),
    readFileSync(join(scripts, "extraDiagnosticMessages.json"), "utf8"),
  );
  expect(readFileSync(join(scripts, "../diagnostics/diagnostics_generated.rs"), "utf8")).toBe(expected);
});
