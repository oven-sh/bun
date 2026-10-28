import * as b from "bun-builtins-table";

// The query keeps the template, the rows and the parameters until it runs.
const heldByQuery = [
  b.retained,
  b.runsTransitively("OwnKeys", "OwnValues", "PrototypeChain", "ToPrimitive", "ToJSON", b.named("length", "raw")),
];

const queriesRows = {
  this: b.any,
  args: { strings: b.any.optional, values: b.any.rest },
  returns: b.any,
  capability: "js",
  throws: true,
  uses: { this: b.inspected, strings: heldByQuery, values: heldByQuery },
  typedResultForm: { form: "Rows", source: "this" },
  implementation: b.generic,
} satisfies b.FunctionField;

const classesWithBody = ["Blob", "Request", "Response"];

export default b.declarations(
  b.fn("Bun.sql", queriesRows),
  // Both names answer the default export of bun:sql: defaultBunSQLObject in BunObject.cpp.
  b.same("Bun.postgres", "Bun.sql"),
  classesWithBody.flatMap(name =>
    b.extend(`${name}.prototype.json`, { bodyBytesForm: "%CompilerHelpers%.jsonSourceOfBody" }),
  ),
);
