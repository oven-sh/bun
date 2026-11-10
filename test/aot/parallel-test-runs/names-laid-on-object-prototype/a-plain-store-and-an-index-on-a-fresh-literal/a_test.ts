import { test } from "bun:test";
const reads = (record: Record<string, unknown>) => [
  (record as any).shade,
  (record as any).tint,
  "shade" in record,
  Object.keys(record).length,
];
function lays(name: string) {
  const above: any = ({} as any)[name];
  above.shade = "laid";
  above["tint"] = "laid too";
  try {
    return reads({});
  } finally {
    delete above.shade;
    delete above.tint;
  }
}
test("t", () => {
  for (const name of JSON.parse('["__proto__","constructor"]')) console.log("SAID", name, lays(name), reads({}));
});
