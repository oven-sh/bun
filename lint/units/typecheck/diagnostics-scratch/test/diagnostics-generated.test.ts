import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { convertPropertyName, generate, merge } from "../crate/scripts/generate-diagnostics.ts";

const scripts = join(import.meta.dir, "../crate/scripts");
const messages = readFileSync(join(scripts, "diagnosticMessages.json"), "utf8");
const extra = readFileSync(join(scripts, "extraDiagnosticMessages.json"), "utf8");

test("diagnostics_generated.rs is up to date", () => {
  const checkedIn = readFileSync(join(scripts, "../diagnostics/diagnostics_generated.rs"), "utf8");
  expect(checkedIn).toBe(generate(messages, extra));
});

test("the merged table has the counts of typescript-go", () => {
  const entries = merge(messages, extra);
  const count = (category: string) => entries.filter(e => e.category === category).length;
  expect({
    total: entries.length,
    error: count("Error"),
    message: count("Message"),
    suggestion: count("Suggestion"),
    warning: count("Warning"),
    sorted: entries.every((e, i) => i === 0 || entries[i - 1].code < e.code),
    first: entries[0].code,
    last: entries.at(-1)!.code,
  }).toEqual({
    total: 2206,
    error: 1379,
    message: 807,
    suggestion: 20,
    warning: 0,
    sorted: true,
    first: 1002,
    last: 100068,
  });
});

test("an extra message replaces the TypeScript message with the same code", () => {
  const byCode = new Map(merge(messages, extra).map(e => [e.code, e.text]));
  expect([1549, 5074, 5090, 5112, 6048, 6353, 6401, 6420, 8030, 9019].map(code => byCode.get(code))).toEqual([
    "Ignore the tsconfig found and build with commandline options and files.",
    "Option '--incremental' is only valid with a known configuration file (like 'tsconfig.json') or when '--tsBuildInfoFile' is explicitly provided.",
    "Non-relative paths are not allowed. Did you forget a leading './'?",
    "tsconfig.json is present but will not be loaded if files are specified on commandline. Use '--ignoreConfig' to skip this error.",
    "Locale must be an IETF BCP 47 language tag. Examples: '{0}', '{1}'.",
    "Failed to delete file '{0}'.",
    "Project '{0}' is out of date because config file does not exist.",
    "Project '{0}' is out of date because input '{1}' does not exist.",
    "A JSDoc '@type' tag on a function must have a signature with the correct number of arguments.",
    "Binding elements with initializers can't be exported directly with --isolatedDeclarations.",
  ]);
});

test("names and keys follow convertPropertyName of generate.go", () => {
  expect(convertPropertyName("'{0}' expected.", 1005)).toEqual({ name: "X_0_expected", key: "_0_expected_1005" });
  expect(convertPropertyName("'*/' expected.", 1010)).toEqual({
    name: "Asterisk_Slash_expected",
    key: "Asterisk_Slash_expected_1010",
  });
  expect(convertPropertyName("Type '{0}' is not assignable to type '{1}'.", 2322)).toEqual({
    name: "Type_0_is_not_assignable_to_type_1",
    key: "Type_0_is_not_assignable_to_type_1_2322",
  });
  expect(
    convertPropertyName(
      "'await' expressions are only allowed within async functions and at the top levels of modules.",
      1308,
    ).name,
  ).toStartWith("X_await_expressions");
  const long = merge(messages, extra).filter(e => e.name.length > 100);
  expect(long.length).toBe(292);
  expect(long.every(e => e.key === e.name.replace(/^X_(?=[a-z])|^X(?=_)/, "").slice(0, 100) + "_" + e.code)).toBe(true);
});
