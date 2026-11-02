import type { NativeCall } from "../builtins-manifest-model.ts";
import { createdFunctionList, nativeCallList } from "../generate-js2native.ts";
import type { Problems, Source, SourcedDeclaration } from "./declarations.ts";
import { pathOfNativeBinding } from "./paths.ts";
import type { BuiltinPath, FeatureUseSpec, NativeCallKind } from "./vocabulary.ts";

interface NativeMacro {
  kind: NativeCallKind;
  createsFunction: boolean;
  answersFunction: boolean;
}

const nativeMacros: Readonly<Record<NativeCall["macro"], NativeMacro>> = {
  cpp: { kind: "Cpp", createsFunction: false, answersFunction: false },
  newCppFunction: { kind: "NewCppFunction", createsFunction: true, answersFunction: true },
  bindgen: { kind: "Bindgen", createsFunction: false, answersFunction: true },
};

const callSites: Source = { file: "src/js", line: null, origin: "Host", proof: "Structure" };

function findDistinctCalls(calls: readonly NativeCall[]): NativeCall[] {
  const distinct = new Map<string, NativeCall>();
  for (const call of calls) {
    const path = pathOfNativeBinding(nativeMacros[call.macro].kind, call.file, call.symbol);
    if (!distinct.has(path)) distinct.set(path, call);
  }
  return [...distinct.values()];
}

function checkNativeCallNumbers(calls: readonly NativeCall[], problems: Problems): void {
  const reportDisagreement = (id: number) =>
    problems.add(callSites, `builtins-manifest-model.ts and generate-js2native.ts disagree about native call ${id}`);
  const registered = nativeCallList();
  const seen = new Set<number>();
  for (const { id, macro } of calls) {
    if (id === null) continue;
    const record = registered[id];
    if (record === undefined || seen.has(id) || record.isWrapped !== nativeMacros[macro].createsFunction) {
      reportDisagreement(id);
    }
    seen.add(id);
  }
  for (const { id } of registered) {
    if (!seen.has(id)) reportDisagreement(id);
  }
}

function collectCreatedFunctions(): SourcedDeclaration[] {
  return createdFunctionList().map(({ kind, file, symbol, hostFunction, header, length }) => ({
    declaration: {
      declares: "Extension",
      path: pathOfNativeBinding(kind, file, symbol),
      columns: { functionObjectCode: { symbol: hostFunction, header }, length },
    },
    source: callSites,
  }));
}

const modulesForTests: ReadonlySet<string> = new Set(["internal-for-testing.ts", "internal/test/binding.ts"]);

// What only the modules for Bun's own tests name leaves an executable with them. One that needs more has a line that lists its features.
export function collectUsesOfBindingsForTests(
  calls: readonly NativeCall[],
  isLeftOutOfTable: (schemaFileName: string) => boolean,
  writtenUses: ReadonlyMap<BuiltinPath, readonly FeatureUseSpec[]>,
): SourcedDeclaration[] {
  return findDistinctCalls(calls)
    .filter(({ file, namedBy }) => !isLeftOutOfTable(file) && namedBy.every(namer => modulesForTests.has(namer)))
    .map(({ macro, file, symbol }) => pathOfNativeBinding(nativeMacros[macro].kind, file, symbol))
    .filter(path => !writtenUses.has(path))
    .map(path => ({
      declaration: { declares: "Extension", path, columns: { usesFeature: ["InternalForTesting"] } },
      source: callSites,
    }));
}

export function collectNativeBindings(
  calls: readonly NativeCall[],
  isLeftOutOfTable: (schemaFileName: string) => boolean,
  bindingsOfOtherValues: ReadonlySet<BuiltinPath>,
  problems: Problems,
): SourcedDeclaration[] {
  const distinct = findDistinctCalls(calls);
  checkNativeCallNumbers(distinct, problems);
  const bindings = distinct.map(({ id, macro, file, symbol }): SourcedDeclaration => ({
    declaration: {
      declares: "NativeBinding",
      kind: nativeMacros[macro].kind,
      file,
      symbol,
      hostNumber: macro === "bindgen" && isLeftOutOfTable(file) ? null : id,
      answersFunction:
        nativeMacros[macro].answersFunction &&
        !bindingsOfOtherValues.has(pathOfNativeBinding(nativeMacros[macro].kind, file, symbol)),
    },
    source: callSites,
  }));
  return [...bindings, ...collectCreatedFunctions()];
}
