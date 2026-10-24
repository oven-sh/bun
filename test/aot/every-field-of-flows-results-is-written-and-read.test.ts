// A field that is read and never written decides by the value it was born with; a field that is written and never read is work
// that nothing came of, or a reader that was never connected. Goes by the text of the engine's sources: the fields of the
// structs named Flow.. in aot/valueflow/*.h and of the records of aot/ir/schema/flow-records.def, and every `.field` and
// `->field` in the compiler outside its tests. A name that several structs share counts for all of them.
//
// NO LINE IS ADDED BELOW. A line goes away with the field, or when its other half is written.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { closingOf, filesOfCompiler, sayWhenSkipped, sources, withoutCommentsAndLiterals } from "./harness/engine-text";

sayWhenSkipped("test/aot/every-field-of-flows-results-is-written-and-read.test.ts");

const known: string[] = [
  "AllocationClass.isStoredUnderUnnamedKeys: neither written nor read",
  "AllocationClass.locality: neither written nor read",
  "ClassFlow.hasAssignedPrototype: never written",
  "FlowAccessSiteNumbering::valueOfSite: never read",
  "FlowBodyApplication::fieldsExpectedAsRead: never read",
  "FlowBodyApplication::firstRunMark: never written",
  "FlowBodyApplication::firstTimeMarks: never written",
  "FlowBodyUpdate::boundClosures: never written",
  "FlowBoundFunctionPlan::firstFunction: never written",
  "FlowCastInsertion::builder: never written",
  "FlowDataNode::rootSite: never written",
  "FlowExportedVariable::exporter: never written",
  "FlowFunctionTables::functionsWhoseClosuresAreNeverCompared: never written",
  "FlowFunctionTables::functionsWithOneClosure: never written",
  "FlowFunctionTables::storedFramePointerUses: never written",
  "FlowModuleLoad::isSynchronous: never written",
  "FlowModuleOrder::componentsCompletedBefore: never read",
  "FlowProgramTables::loadsOfMachineCode: never written",
  "FlowReport::builtinsUsed: never read",
  "FlowReport::featuresUsed: never read",
  "FlowReport::localesUsed: never read",
  "FlowResultTables::wholeProgram: never written",
  "FlowScopeCalls::firstByCallee: never read",
  "FlowScopeCalls::firstByCaller: never read",
  "FlowScopeIndex::functionsEnteredWithoutMention: never written",
  "FlowScopeIndex::mentions: never read",
  "FlowScopeIndex::moduleOrder: never written",
  "FlowSignatureUpdate::provenCapabilities: never written",
  "LayoutFlow.isReachedThroughUnknownReceivers: never written",
  "LayoutFlow.ownAccessors: never written",
  "LayoutFlow.ownAccessorsAreComplete: never written",
];

const member =
  /^\s+(?:mutable\s+)?(?!return\b|using\b|static\b|friend\b|typedef\b|enum\b|struct\b|class\b)[A-Za-z_][\w:<>,*&\s]*?[\s*&>](\w+)\s*(?:\{[^;]*\}|=[^;]*)?;\s*$/;
const stores =
  /^\s*(?:=(?!=)|[-+|&^]=|<<=|\+\+|--|\[[^\]]*\]\s*(?:=(?!=)|[-+|&]=|\.)|\.(?:append|appendVector|appendRange|appendList|constructAndAppend|add|set|insert|ensure|grow|resize|fill|merge|formUnion|swap|quickSet|quickClear|remove|removeAll|clear|reserveInitialCapacity|shrink|emplace|at\([^)]*\)\s*(?:=(?!=)|[-+|&]=|\.))\b)/;

test.skipIf(!sources)("every field of flow's results has a writer and a reader", () => {
  const fields = new Map<string, string>();
  const texts = [...filesOfCompiler()];
  for (const { name, text } of texts) {
    if (!/^valueflow\/[^/]*\.h$/.test(name)) continue;
    for (const match of text.matchAll(/\bstruct\s+(Flow\w*)\s*(?:final\s*)?\{/g)) {
      const open = match.index + match[0].length - 1;
      let body = text.slice(open + 1, closingOf(text, open));
      for (let brace; (brace = body.indexOf("{")) >= 0;)
        body = body.slice(0, brace) + body.slice(closingOf(body, brace) + 1);
      for (const line of body.split("\n")) {
        const field = member.exec(line.includes("(") ? "" : line.replace(/\s*$/, ""))?.[1];
        if (field !== undefined) fields.set(field, `${match[1]}::${field}`);
      }
    }
  }
  const schema = withoutCommentsAndLiterals(
    readFileSync(join(sources!, "ir", "schema", "flow-records.def"), "utf8").replace(/#[^\n]*/g, ""),
  );
  for (const [, record, body] of schema.matchAll(/\brecord\s+(\w+)[^{\n]*\{([^}]*)\}/g))
    for (const [, field] of body.matchAll(/\b([a-z]\w*)\s*:/g))
      if (!fields.has(field)) fields.set(field, `${record}.${field}`);
  expect(fields.size).toBeGreaterThan(150);

  const written = new Set<string>();
  const read = new Set<string>();
  for (const { text } of texts) {
    for (const match of text.matchAll(/(\.|->|::)\s*(\w+)\b(?!\s*\()/g)) {
      const field = match[2];
      if (!fields.has(field)) continue;
      const before = text.slice(Math.max(0, match.index - 2), match.index);
      const isDesignated = match[1] === "." && /[{,(]\s*$/.test(text.slice(Math.max(0, match.index - 80), match.index));
      if (
        match[1] === "::" &&
        !before.endsWith("&") &&
        !/&\w*$/.test(text.slice(Math.max(0, match.index - 60), match.index))
      )
        continue;
      if (isDesignated || stores.test(text.slice(match.index + match[0].length, match.index + match[0].length + 80)))
        written.add(field);
      else read.add(field);
    }
  }
  const halves = [...fields]
    .filter(([field]) => !written.has(field) || !read.has(field))
    .map(
      ([field, owner]) =>
        `${owner}: ${!written.has(field) && !read.has(field) ? "neither written nor read" : written.has(field) ? "never read" : "never written"}`,
    )
    .sort();
  expect(halves.filter(half => !known.includes(half))).toEqual([]);
});
