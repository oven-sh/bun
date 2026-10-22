import { checkEntries } from "./check-entries.ts";
import { checkResults } from "./check-results.ts";
import { checkRuntime } from "./check-runtime.ts";
import { checkTypes } from "./check-types.ts";
import type { Schema } from "./model.ts";
import { ErrorList } from "./source.ts";

type Check = (schema: Schema, errors: ErrorList) => void;

const checks: readonly Check[] = [checkTypes, checkEntries, checkResults, checkRuntime];

export function checkSchema(schema: Schema): void {
  const errors = new ErrorList();
  for (const check of checks) check(schema, errors);
  errors.throwIfAny(schema.files);
}
