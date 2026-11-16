import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

function matchesRow(kind: string, value: string, got: unknown): boolean {
  switch (kind) {
    case "undefined":
      return got === undefined;
    case "null":
      return got === null;
    case "boolean":
      return got === (value === "true");
    case "number":
      return typeof got === "number" && Object.is(got, value === "-0" ? -0 : Number(value));
    case "string":
      return got === value;
    case "bigint":
      return typeof got === "bigint" && String(got) === value;
    default:
      return false;
  }
}

describe("constant-expressions.txt", () => {
  test("every value is what Bun computes", () => {
    const lines = readFileSync(join(import.meta.dir, "constant-expressions.txt"), "utf8").split("\n");
    const wrong: string[] = [];
    let rows = 0;
    lines.forEach((line, index) => {
      if (line === "" || line.startsWith("#")) return;
      const [kind, value, ...rest] = line.split("\t");
      if (kind === "unknown") return;
      const expression = rest.join("\t");
      rows++;
      if (!matchesRow(kind, value, (0, eval)("(" + expression + ")"))) wrong.push(`${index + 1}: ${expression}`);
    });
    expect(wrong).toEqual([]);
    expect(rows).toBeGreaterThan(200);
  });
});
