import fs from "node:fs";
import path from "node:path";
import { checkSchema } from "./checks.ts";
import { kindText, schemaHash } from "./hash.ts";
import type { Effects, SchemaEnum, Schema as SchemaModel } from "./model.ts";
import { isIntrinsic } from "./model.ts";
import { parseSchema } from "./parse.ts";
import { resolveSchema } from "./resolve.ts";
import type { ReadFile } from "./source.ts";

export interface LoadedSchema {
  readonly model: SchemaModel;
  readonly hash: bigint;
  readonly directory: string;
  readonly inputs: readonly string[];
}

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

export function loadSchemaFrom(rootPath: string, readFile: ReadFile): { model: SchemaModel; hash: bigint } {
  const model = resolveSchema(parseSchema(rootPath, readFile));
  checkSchema(model);
  return { model, hash: schemaHash(model) };
}

export function loadSchemaModel(schemaFile: string): LoadedSchema {
  const directory = path.dirname(path.resolve(schemaFile));
  const readFile: ReadFile = relativePath => {
    try {
      return fs.readFileSync(path.join(directory, relativePath), "utf8");
    } catch {
      return null;
    }
  };
  const { model, hash } = loadSchemaFrom(path.basename(schemaFile), readFile);
  return { model, hash, directory, inputs: model.files.map(file => file.path) };
}

function memberNames(types: readonly SchemaEnum[]): Map<string, readonly string[]> {
  return new Map(types.map(type => [type.name, type.members.map(member => member.name)]));
}

function summarizeEffects(effects: Effects): EffectsSummary {
  const { isUnknownCode, readsAllHeaps, writesAllHeaps, reads, writes, throws, collects, suspends, terminates } =
    effects;
  return {
    isUnknownCode,
    readsAllHeaps,
    writesAllHeaps,
    reads: reads.map(reference => reference.heap.name),
    writes: writes.map(reference => reference.heap.name),
    throws,
    collects,
    suspends,
    terminates,
  };
}

export function summarize(model: SchemaModel): Schema {
  return {
    enums: memberNames([...model.enums, ...model.generatedEnums.values()]),
    flags: memberNames(model.flagWords),
    heaps: model.heaps.map(heap => heap.name),
    namedEffects: new Map(model.namedEffects.map(named => [named.name, summarizeEffects(named.effects)])),
    inlineBuiltins: new Map(
      model.inlineBuiltins.map(builtin => [
        builtin.name,
        {
          parameters: builtin.parameterKinds.map(kind => kindText(kind)),
          hasOptionalSlowPath: builtin.hasOptionalSlowPath,
          effects: builtin.effects.isAsOverload ? "asOverload" : summarizeEffects(builtin.effects),
        },
      ]),
    ),
    operations: new Map(model.operations.map(operation => [operation.name, { isIntrinsic: isIntrinsic(operation) }])),
    externals: new Map(model.externals.map(external => [external.name, external.members])),
  };
}

export function loadSchema(schemaFile: string): Schema {
  return summarize(loadSchemaModel(schemaFile).model);
}
