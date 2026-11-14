import { expect, test } from "bun:test";
import { engineFile } from "../../../src/codegen/engine-directory.ts";

// The generator of the table keeps one record for each function and condition of an entry. It builds them ahead of the numbering, where every built-in has the id -1.
test("two records of one function whose conditions differ in nothing but the object that each names stay two", async () => {
  const { addCalledFunction, conditionOnNoOperand } = await import(
    engineFile("builtins/generator/build-attachments.ts")
  );
  const entry = (token: string) => ({ id: -1, token });
  for (const field of ["calledOn", "programStores"]) {
    const records = new Map();
    for (const token of ["First", "Second"]) {
      const condition = { ...conditionOnNoOperand, [field]: entry(token) };
      addCalledFunction(records, { function: { id: 7 }, condition, uses: null });
    }
    expect([field, records.size]).toEqual([field, 2]);
  }
});
