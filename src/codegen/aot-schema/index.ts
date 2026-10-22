import path from "node:path";
import { parseArgs } from "node:util";
import { findUnusedNames } from "./check-uses.ts";
import { loadSchemaModel, type LoadedSchema } from "./load.ts";
import { engineOutputs, findStaleOutputs, rustOutputs, writeOutputs, type OutputFile } from "./outputs.ts";
import { SchemaError, SchemaErrors } from "./source.ts";

const usage = `usage: <bun or node> src/codegen/aot-schema/index.ts --schema <AOTSchema.def> [options]
  --engine-out <dir>     write the C++ outputs (JavaScriptCore/aot/ir/generated)
  --rust-out <dir>       write the outputs for Bun's tree: the Rust files and AOTSchemaHash.h (src/aot/ir/generated)
  --check                write nothing: fail when a file is not what would be written
  --check-uses <path>    fail when a name of the schema that needs a use has none in the file <path>, or in the .cpp, .h and .rs
                         files under the folder <path>, folders named "generated" left out (may be repeated)
  --hash                 print the schema hash
  --list                 print the names of all outputs`;

interface Options {
  readonly schema: string;
  readonly engineOut: string | undefined;
  readonly rustOut: string | undefined;
  readonly check: boolean;
  readonly checkUses: readonly string[];
  readonly hash: boolean;
  readonly list: boolean;
}

function readOptions(argv: readonly string[]): Options {
  const { values } = parseArgs({
    args: [...argv],
    strict: true,
    options: {
      "schema": { type: "string" },
      "engine-out": { type: "string" },
      "rust-out": { type: "string" },
      "check": { type: "boolean", default: false },
      "check-uses": { type: "string", multiple: true, default: [] },
      "hash": { type: "boolean", default: false },
      "list": { type: "boolean", default: false },
    },
  });
  if (values.schema === undefined) throw new Error(usage);
  return {
    schema: values.schema,
    engineOut: values["engine-out"],
    rustOut: values["rust-out"],
    check: values.check,
    checkUses: values["check-uses"],
    hash: values.hash,
    list: values.list,
  };
}

function updateFolder(directory: string, files: readonly OutputFile[], check: boolean): string[] {
  if (!check) {
    writeOutputs(directory, files);
    return [];
  }
  return findStaleOutputs(directory, files).map(stale => `${path.join(directory, stale.name)} ${stale.problem}`);
}

function updateOutputs(options: Options, loaded: LoadedSchema): string[] {
  const problems: string[] = [];
  if (options.engineOut !== undefined) problems.push(...updateFolder(options.engineOut, engineOutputs(loaded), options.check));
  if (options.rustOut !== undefined) problems.push(...updateFolder(options.rustOut, rustOutputs(loaded), options.check));
  if (problems.length > 0) problems.push("run src/codegen/aot-schema/index.ts without --check and check the result in");
  return problems;
}

function run(options: Options, loaded: LoadedSchema): string[] {
  if (options.hash) console.log(`0x${loaded.hash.toString(16).padStart(16, "0")}`);
  if (options.list) {
    for (const file of engineOutputs(loaded)) console.log(`engine/${file.name}`);
    for (const file of rustOutputs(loaded)) console.log(`rust/${file.name}`);
  }
  const problems = updateOutputs(options, loaded);
  if (options.checkUses.length > 0) {
    for (const unused of findUnusedNames(loaded.model, options.checkUses)) {
      const { path: file, line, column } = unused.location;
      problems.push(`${file}:${line}:${column}: ${unused.spelling} has no use`);
    }
  }
  return problems;
}

function tryReadOptions(argv: readonly string[]): Options | null {
  try {
    return readOptions(argv);
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    console.error(error.message);
    return null;
  }
}

function main(argv: readonly string[]): number {
  const options = tryReadOptions(argv);
  if (options === null) return 1;
  try {
    const problems = run(options, loadSchemaModel(options.schema));
    for (const problem of problems) console.error(problem);
    return problems.length > 0 ? 1 : 0;
  } catch (error) {
    if (!(error instanceof SchemaError) && !(error instanceof SchemaErrors)) throw error;
    console.error(error.message);
    return 1;
  }
}

process.exit(main(process.argv.slice(2)));
