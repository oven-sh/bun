// Expected: parses (annotation ignored). Actual: RangeError.
try {
  Temporal.PlainDate.from("2025-01-01[" + "A".repeat(15) + "]");
  throw new Error("FIXED");
} catch (e) {
  if (e instanceof RangeError) print("BUG: 15-char component rejected");
  else throw e;
}
