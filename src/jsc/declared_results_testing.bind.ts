// Native code that answers outside the type it declares, on purpose: test/aot/held-results.test.ts
import * as b from "../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::declared_results_testing" });

/** Answers with `value` itself, whatever it is. */
export const declaredAsString = b.fn({
  args: { value: b.any },
  returns: b.any.returning("string"),
  capability: "heap",
});
export const holdsResultsToDeclaredTypes = b.fn({ returns: b.bool });
