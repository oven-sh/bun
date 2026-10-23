import { GeneratorError, type Problems } from "./declarations.ts";
import { bitsOfDouble } from "./double-bits.ts";
import { fileHeader } from "./emit-rust-ids.ts";
import type { ModelName, ModelOperand } from "./model.ts";
import type { Capability } from "./vocabulary.ts";

export type AggregateMember = readonly [name: string, value: string | null];

export const capabilityEnumerators: Readonly<Record<Capability, string>> = { js: "JS", heap: "Heap", none: "None" };

const licenseHeader = `/*
 * Copyright (C) 2026 Oven, Inc. All rights reserved.
 * SPDX-License-Identifier: BSD-2-Clause
 */`;

export function checkDenseIds(cppType: string, items: readonly { id: number }[], problems: Problems): void {
  const position = items.findIndex((item, index) => item.id !== index);
  if (position !== -1) problems.add(null, `${cppType}(${items[position].id}) is at position ${position} of its list`);
}

export function formatAggregate(members: readonly AggregateMember[]): string {
  const printed = members.flatMap(([name, value]) => (value === null ? [] : [`.${name} = ${value}`]));
  return printed.length === 0 ? "{ }" : `{ ${printed.join(", ")} }`;
}

export function formatUnlessEmpty(members: readonly AggregateMember[]): string | null {
  return members.every(([, value]) => value === null) ? null : formatAggregate(members);
}

export function formatUnlessZero(value: number): string | null {
  return value === 0 ? null : String(value);
}

export function formatId(cppType: string, item: { id: number }): string;
export function formatId(cppType: string, item: { id: number } | null): string | null;
export function formatId(cppType: string, item: { id: number } | null): string | null {
  return item === null ? null : `${cppType}(${item.id})`;
}

export function formatName(name: ModelName): string;
export function formatName(name: ModelName | null): string | null;
export function formatName(name: ModelName | null): string | null {
  return name === null ? null : `BuiltinName(${name.number})`;
}

export function formatEnumerator(cppEnum: string, word: string): string {
  return `${cppEnum}::${word}`;
}

export function formatUnlessDefault<Word extends string>(
  cppEnum: string,
  word: Word,
  defaultWord: Word,
): string | null {
  return word === defaultWord ? null : formatEnumerator(cppEnum, word);
}

export function formatOptionSet(cppEnum: string, words: readonly string[]): string | null {
  if (words.length === 0) return null;
  return `{ ${words.map(word => formatEnumerator(cppEnum, word)).join(", ")} }`;
}

export function formatOperand(operand: ModelOperand): string;
export function formatOperand(operand: ModelOperand | null): string | null;
export function formatOperand(operand: ModelOperand | null): string | null {
  if (operand === null) return null;
  switch (operand.operand) {
    case "Receiver":
      return "BuiltinOperand::receiver()";
    case "Argument":
      return `BuiltinOperand::argument(${operand.index})`;
    case "ArgumentsFrom":
      return `BuiltinOperand::argumentsFrom(${operand.index})`;
  }
}

export function formatDouble(value: number): string {
  return `std::bit_cast<double>(0x${bitsOfDouble(value).toString(16).toUpperCase().padStart(16, "0")}ULL)`;
}

export function formatInt64(value: number): string {
  if (!Number.isSafeInteger(value)) throw new GeneratorError(`${value} is not an integer that a double holds exactly`);
  return `${value}LL`;
}

// What stands between the quotes of a C++ literal.
export function formatCharacters(text: string): string {
  if (!/^[\x00-\x7f]*$/.test(text)) throw new GeneratorError(`${JSON.stringify(text)} is not ASCII`);
  return text
    .replace(/[\\"]/g, "\\$&")
    .replace(/[\x00-\x1f\x7f]/g, character => `\\${character.charCodeAt(0).toString(8).padStart(3, "0")}`);
}

export function lengthOfCharacters(formatted: string): number {
  return formatted.replace(/\\(?:[0-7]{3}|.)/g, "?").length;
}

export function formatASCIILiteral(text: string): string {
  return `"${formatCharacters(text)}"_s`;
}

// AOTBuiltinTable.h declares these without a bound and code of the engine names them: a table defines each, whether or not it has a record.
const arraysNamedByEngine: ReadonlySet<string> = new Set([
  "builtinTableOverloads",
  "builtinTableDispatches",
  "builtinTableDispatchNodes",
  "builtinTableTypes",
  "builtinTableFeatureUses",
  "builtinTableModuleLoads",
  "builtinTableCalledFunctions",
  "builtinTableStartupCalledFunctions",
  "builtinTableHostObjects",
  "builtinTableNamedMemberCalls",
  "builtinTableHostMethodCalls",
  "builtinTableForms",
  "builtinTableClassesByMemberName",
]);

export function emitArray(declaration: string, elements: readonly string[]): string {
  if (elements.length === 0) {
    const name = declaration.slice(declaration.lastIndexOf(" ") + 1);
    return arraysNamedByEngine.has(name) ? `${declaration}[] = {\n    { },\n};` : "";
  }
  return `${declaration}[] = {\n${elements.map(element => `    ${element},`).join("\n")}\n};`;
}

export function emitArrayOfConstants(
  cppType: string,
  arrayName: string,
  constantPrefix: string,
  elements: readonly string[],
): string {
  const names = elements.map((_, index) => `${constantPrefix}${index}`);
  const constants = elements.map((element, index) => `static constexpr ${cppType} ${names[index]} = ${element};`);
  return joinBlocks([constants.join("\n"), emitArray(`constinit const ${cppType} ${arrayName}`, names)]);
}

export function emitMacroList(name: string, entries: readonly string[]): string {
  return `#define ${name}(macro)${entries.map(entry => ` \\\n    macro(${entry})`).join("")}`;
}

export function joinBlocks(blocks: readonly string[]): string {
  return blocks.filter(block => block !== "").join("\n\n");
}

function formatInclude(header: string): string {
  return header.startsWith("<") ? `#include ${header}` : `#include "${header}"`;
}

export function wrapFile(includes: readonly string[], body: string): string {
  const blocks = [
    `${fileHeader}${licenseHeader}`,
    '#include "config.h"',
    "#if ENABLE(AOT)",
    includes.map(formatInclude).join("\n"),
    "namespace JSC { namespace AOT {",
    body,
    "} } // namespace JSC::AOT",
    "#endif // ENABLE(AOT)",
  ];
  return `${joinBlocks(blocks)}\n`;
}

export class Pool {
  readonly #cppType: string;
  readonly #arrayName: string;
  readonly #elements: string[] = [];
  readonly #firstOfRun = new Map<string, number>();
  readonly #isDeclaredInHeader: boolean;

  // An array that AOTBuiltinTable.h declares is named by stretches too: see BuiltinRecordStretch there.
  constructor(cppType: string, arrayName: string, isDeclaredInHeader = false) {
    this.#cppType = cppType;
    this.#arrayName = arrayName;
    this.#isDeclaredInHeader = isDeclaredInHeader;
  }

  #findOrAppend(run: readonly string[]): number {
    const key = run.join("\n");
    let first = this.#firstOfRun.get(key);
    if (first === undefined) {
      first = this.#elements.length;
      this.#elements.push(...run);
      this.#firstOfRun.set(key, first);
    }
    return first;
  }

  add(elements: readonly string[]): string | null {
    if (elements.length === 0) return null;
    const first = this.#findOrAppend(elements);
    return `std::span<const ${this.#cppType}>(${this.#arrayName}).subspan(${first}, ${elements.length})`;
  }

  addElement(element: string): string {
    return `&${this.#arrayName}[${this.#findOrAppend([element])}]`;
  }

  #checkedIndex(index: number): number {
    if (!this.#isDeclaredInHeader)
      throw new GeneratorError(`${this.#arrayName} is not declared in the header, so no stretch can name it`);
    if (index > 0xfffe) throw new GeneratorError(`${this.#arrayName} has more records than 16 bits number`);
    return index;
  }

  addStretch(elements: readonly string[]): string | null {
    if (elements.length === 0) return null;
    const first = this.#findOrAppend(elements);
    return `{ ${this.#checkedIndex(first)}, ${this.#checkedIndex(elements.length)} }`;
  }

  addNumberedElement(element: string): string {
    return String(this.#checkedIndex(this.#findOrAppend([element])));
  }

  addIndexedElement(cppPointerType: string, element: string): string {
    return `${cppPointerType}(${this.#checkedIndex(this.#findOrAppend([element]))})`;
  }

  emit(): string {
    // The header declares the array whether or not it has a record.
    if (this.#isDeclaredInHeader) {
      const elements = this.#elements.length === 0 ? ["{ }"] : this.#elements;
      return emitArray(`constinit const ${this.#cppType} ${this.#arrayName}`, elements);
    }
    return emitArray(`static constinit const ${this.#cppType} ${this.#arrayName}`, this.#elements);
  }
}
