// The generator of the schema is the engine's: JavaScriptCore/aot/ir/generator, beside the schema it reads. This is what the
// generator of the table of built-ins takes from it.
import { createRequire } from "node:module";
import path from "node:path";

export interface EffectsSummary {
  readonly isUnknownCode: boolean;
  readonly readsAllHeaps: boolean;
  readonly writesAllHeaps: boolean;
  readonly reads: readonly string[];
  readonly writes: readonly string[];
  readonly throws: boolean;
  readonly collects: boolean;
  readonly suspends: boolean;
  readonly terminates: boolean;
}

export interface InlineBuiltinSummary {
  readonly parameters: readonly string[];
  readonly hasOptionalSlowPath: boolean;
  readonly effects: EffectsSummary | "asOverload";
}

export interface OperationSummary {
  readonly isIntrinsic: boolean;
}

export interface Schema {
  readonly enums: ReadonlyMap<string, readonly string[]>;
  readonly flags: ReadonlyMap<string, readonly string[]>;
  readonly heaps: readonly string[];
  readonly namedEffects: ReadonlyMap<string, EffectsSummary>;
  readonly inlineBuiltins: ReadonlyMap<string, InlineBuiltinSummary>;
  readonly operations: ReadonlyMap<string, OperationSummary>;
  readonly externals: ReadonlyMap<string, readonly string[]>;
}

export function loadSchema(schemaFile: string): Schema {
  const generator = path.join(path.dirname(path.resolve(schemaFile)), "generator", "load.ts");
  return createRequire(import.meta.url)(generator).loadSchema(schemaFile);
}
