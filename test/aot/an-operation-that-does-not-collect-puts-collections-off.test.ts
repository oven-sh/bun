// Compiled code calls an operation whose row in the tables of run-time operations does not say `collects` without telling
// the collector what it holds. A collection that is owed starts wherever somebody stops putting collections off, whether or
// not anything was allocated, so such an operation puts collections off for as long as it runs. AOT_OPERATION_BEGIN does not
// compile for such a row. This test is for the operations that do not use it. Goes by the text of the engine's sources.
//
// THE LIST BELOW ONLY SHRINKS. A new operation that is handed the instance opens LeafOperationScope or begins with
// AOT_OPERATION_BEGIN_WITHOUT_COLLECTION. What is on the list has a few lines that read words, compare characters or tell
// the collector of a store: they make no cell, give no rope its text, look no name up and call nothing that does.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { closingOf, filesOfCompiler, sayWhenSkipped, sources } from "./harness/engine-text";

sayWhenSkipped("test/aot/an-operation-that-does-not-collect-puts-collections-off.test.ts");

const opensNoScope = new Set([
  "AddressOfThrow",
  "ArrayIndexOfDouble",
  "ArrayIndexOfInt32",
  "BarrierSlow",
  "BarrierSlowPreservingRegisters",
  "CountLongSeparators16",
  "CountLongSeparators8",
  "CountStopsForCollector",
  "DateNow",
  "FillVariablesOfFiles",
  "FindLongSeparators16",
  "FindLongSeparators8",
  "GetMappedArgument",
  "HasExtraProperty",
  "IsCallable",
  "IsConstructor",
  "IsGeneratorSuspendedAtStart",
  "JSONEnterWatchedLevel",
  "JSONFindMember",
  "JSONMemberRepeats",
  "JSONObjectKey",
  "JSONParseInteger",
  "JSONParseNumber",
  "JSONSourceAbandon",
  "JSONSourceClose",
  "NoteFailedGuard",
  "RecordArrival",
  "RememberElement",
  "SetMappedArgument",
  "ShortStringOfString",
  "StackStringBuilderDiscard",
  "StringBuilderDiscard",
  "StringBuilderRollBack",
  "StringEqualsLiteral",
  "StringEqualsLiteralInRegister",
  "StringFindLiteral8",
  "StringReverseFindLiteral8",
  "ToBoolean",
  "ToLiteralString",
  "TypeOf",
]);

function operationsThatDoNotCollect(): string[] {
  const tables = ["runtime-operations.def", "runtime-property-operations.def", "runtime-builtin-operations.def"].map(
    table => readFileSync(join(sources!, "ir", "schema", table), "utf8"),
  );
  const named = new Map<string, string>();
  for (const table of tables)
    for (const [, name, effects] of table.matchAll(/^effects (\w+) = (.*)$/gm)) named.set(name, effects);
  const spelledOut = (effects: string): string =>
    effects.replace(/\b[A-Z]\w+\b/g, word => (named.has(word) ? spelledOut(named.get(word)!) : word));
  const found: string[] = [];
  for (const table of tables)
    for (const [, names, effects] of table.matchAll(/^runtime ([\w, ]+?) : [^;]* ; (.*)$/gm))
      if (!/\b(?:collects|unknownCode)\b/.test(spelledOut(effects))) found.push(...names.split(", "));
  return found;
}

test.skipIf(!sources)("each such operation that is handed the instance puts collections off while it runs", () => {
  const wanted = new Set(operationsThatDoNotCollect());
  expect(wanted.size).toBeGreaterThan(100);
  const withoutScope: string[] = [];
  let withScope = 0;
  for (const { text } of filesOfCompiler()) {
    for (const definition of text.matchAll(/\bJSC_DEFINE\w*_JIT_OPERATION\s*\(\s*operationAOT(\w+)\s*,/g)) {
      if (!wanted.has(definition[1])) continue;
      const head = text.slice(definition.index, closingOf(text, text.indexOf("(", definition.index)));
      if (!/\bInstance\s*\*/.test(head)) continue;
      const open = text.indexOf("{", definition.index + head.length);
      const body = text.slice(open, closingOf(text, open));
      if (
        /\bAOT_OPERATION_BEGIN_(?:WITHOUT_COLLECTION|THROW_OF_VALUE)\s*\(|\bLeafOperationScope\s+\w+|^\s*\{(?:\s*(?:VM\s*&\s*\w+\s*=[^;]*|RELEASE_ASSERT\s*\([^;]*);)*\s*DeferGCForAWhile\s+\w+/.test(
          body,
        )
      )
        withScope++;
      else withoutScope.push(definition[1]);
    }
  }
  expect(withoutScope.sort()).toEqual([...opensNoScope].sort());
  expect(withScope).toBeGreaterThan(40);
});
