import { GeneratorError, proofs, type Proof, type SourcedDeclaration } from "./declarations.ts";
import { bitsOfDouble } from "./double-bits.ts";
import type { ModelEngineFile } from "./model.ts";

export interface EngineDeclarations {
  declarations: SourcedDeclaration[];
  engineFiles: ModelEngineFile[];
}

type JsonRecord = Record<string, unknown>;
type Fail = (message: string) => never;

const bitsPattern = /^0x[0-9a-f]{16}$/;

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function bitsOfNumber(value: number): string {
  return `0x${bitsOfDouble(value).toString(16).padStart(16, "0")}`;
}

function numberOfBits(bits: string): number {
  const view = new DataView(new ArrayBuffer(8));
  view.setBigUint64(0, BigInt(bits));
  return view.getFloat64(0);
}

function replaceNumber(_key: string, value: unknown): unknown {
  if (typeof value !== "number" || (Number.isFinite(value) && !Object.is(value, -0))) return value;
  return { bits: bitsOfNumber(value) };
}

function reviveNumber(_key: string, value: unknown): unknown {
  if (!isRecord(value) || Object.keys(value).length !== 1) return value;
  const { bits } = value;
  return typeof bits === "string" && bitsPattern.test(bits) ? numberOfBits(bits) : value;
}

const serializeLines = (items: readonly unknown[]): string =>
  items.map(item => JSON.stringify(item, replaceNumber)).join(",\n");

export function serializeEngineDeclarations(value: EngineDeclarations): string {
  return [
    "{",
    '"declarations": [',
    serializeLines(value.declarations),
    "],",
    '"engineFiles": [',
    serializeLines(value.engineFiles),
    "]",
    "}",
    "",
  ].join("\n");
}

function checkDeclaration(value: unknown, position: number, fail: Fail): SourcedDeclaration {
  const owner = `declarations[${position}]`;
  if (!isRecord(value) || !isRecord(value.declaration) || !isRecord(value.source)) {
    return fail(`${owner} is not a declaration with its source`);
  }
  if (typeof value.declaration.declares !== "string") return fail(`${owner} does not say what it declares`);
  const { file, line, origin, proof } = value.source;
  if (typeof file !== "string") return fail(`${owner} has no source file`);
  if (line !== null && !Number.isInteger(line)) return fail(`${owner} has a source line that is no integer`);
  if (origin !== "Engine") return fail(`${owner} does not come from the engine`);
  if (!proofs.includes(proof as Proof)) return fail(`${owner} has the unknown proof ${String(proof)}`);
  return value as unknown as SourcedDeclaration;
}

function checkEngineFile(value: unknown, position: number, fail: Fail): ModelEngineFile {
  if (!isRecord(value) || typeof value.name !== "string" || typeof value.text !== "string") {
    return fail(`engineFiles[${position}] is not a name and a text`);
  }
  return { name: value.name, text: value.text };
}

export function parseEngineDeclarations(text: string, file: string): EngineDeclarations {
  const fail: Fail = message => {
    throw new GeneratorError(`${file}: ${message}`);
  };
  let json: unknown;
  try {
    json = JSON.parse(text, reviveNumber);
  } catch (cause) {
    return fail(`not JSON: ${String(cause)}`);
  }
  if (!isRecord(json)) return fail("the engine's declarations are not an object");
  const { declarations, engineFiles } = json;
  if (!Array.isArray(declarations)) return fail("declarations is not a list");
  if (!Array.isArray(engineFiles)) return fail("engineFiles is not a list");
  return {
    declarations: declarations.map((value, position) => checkDeclaration(value, position, fail)),
    engineFiles: engineFiles.map((value, position) => checkEngineFile(value, position, fail)),
  };
}
