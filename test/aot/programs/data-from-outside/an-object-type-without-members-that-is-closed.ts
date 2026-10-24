import { JSON, type Schema } from "bun";

function attempt(name: string, run: () => unknown) {
  try {
    console.log(name, "takes", JSON.stringify(run()));
  } catch (error) {
    for (const issue of (error as Schema.Error).issues) console.log(name, "refuses at", JSON.stringify(issue.path), "for", issue.code);
  }
}

interface Empty {}

for (const text of ["{}", '{"admin":true}', "[]", "1"]) {
  attempt("{} & Strict", () => JSON.parse<{} & Schema.Strict>(text));
  attempt("{} & DeepStrict", () => JSON.parse<{} & Schema.DeepStrict>(text));
  attempt("Strict", () => JSON.parse<Schema.Strict>(text));
  attempt("Empty & Strict", () => JSON.parse<Empty & Schema.Strict>(text));
  attempt("Record<never, never> & Strict", () => JSON.parse<Record<never, never> & Schema.Strict>(text));
  attempt("Omit<{ a: 1 }, 'a'> & Strict", () => JSON.parse<Omit<{ a: 1 }, "a"> & Schema.Strict>(text));
  attempt("Pick<{ a: 1 }, never> & Strict", () => JSON.parse<Pick<{ a: 1 }, never> & Schema.Strict>(text));
  attempt("{ a?: 1 } & Strict", () => JSON.parse<{ a?: 1 } & Schema.Strict>(text));
  attempt("{}", () => JSON.parse<{}>(text));
}
for (const text of ['{"a":{}}', '{"a":{"admin":true}}']) {
  attempt("{ a: {} & Strict }", () => JSON.parse<{ a: {} & Schema.Strict }>(text));
  attempt("{ a: {} } & DeepStrict", () => JSON.parse<{ a: {} } & Schema.DeepStrict>(text));
}
for (const text of ["[{}]", '[{"admin":true}]']) attempt("({} & Strict)[]", () => JSON.parse<({} & Schema.Strict)[]>(text));
