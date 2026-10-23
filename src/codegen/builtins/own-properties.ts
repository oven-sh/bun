import { readFileSync } from "node:fs";
import path from "node:path";
import { GeneratorError, type Declaration, type Problems, type SourcedDeclaration } from "./declarations.ts";
import { compareBytes, memberPathOf, registeredSymbolPrefix, symbolPrefix } from "./paths.ts";

export interface OwnProperty {
  name: string;
  attributes: { isAccessor: boolean; isWritable: boolean; isConfigurable: boolean } | null;
  /** Written "~": the host creates the property in some runs only, so nobody states its attributes. */
  isCreatedInSomeRuns: boolean;
}

export interface OwnPropertyLine {
  holder: string;
  isOpen: boolean;
  properties: OwnProperty[];
}

const linePattern = /^(\S+)( open)? :((?: \S+\/(?:\?|~|-|a?w?c?))*)$/;
const createdInSomeRunsMark = "~";
const wellKnownSymbolPattern = new RegExp(`^${symbolPrefix}[A-Za-z]+$`);

export function isListableName(name: string): boolean {
  if (name.startsWith(registeredSymbolPrefix)) return name.length > registeredSymbolPrefix.length;
  return !name.startsWith(symbolPrefix) || wellKnownSymbolPattern.test(name);
}

function fail(lineNumber: number, message: string): never {
  throw new GeneratorError(`the list of own properties, line ${lineNumber}: ${message}`);
}

function parseAttributes(text: string, name: string, lineNumber: number): OwnProperty["attributes"] {
  if (text === "?" || text === createdInSomeRunsMark) return null;
  if (text === "") fail(lineNumber, `${name} has no attributes`);
  if (text.includes("a") && text.includes("w")) fail(lineNumber, `${name} is both accessor and writable`);
  return { isAccessor: text.includes("a"), isWritable: text.includes("w"), isConfigurable: text.includes("c") };
}

function parseProperties(text: string, lineNumber: number): OwnProperty[] {
  const properties: OwnProperty[] = [];
  for (const entry of text.split(" ").slice(1)) {
    const separator = entry.lastIndexOf("/");
    const name = entry.slice(0, separator);
    if (!isListableName(name)) fail(lineNumber, `${name} is neither a well-known nor a registered symbol`);
    const previous = properties.at(-1);
    if (previous && compareBytes(previous.name, name) >= 0) fail(lineNumber, `${name} is repeated or out of order`);
    const written = entry.slice(separator + 1);
    properties.push({
      name,
      attributes: parseAttributes(written, name, lineNumber),
      isCreatedInSomeRuns: written === createdInSomeRunsMark,
    });
  }
  return properties;
}

export function parseOwnProperties(text: string): OwnPropertyLine[] {
  const pieces = text.split("\n");
  if (pieces.at(-1) !== "") fail(pieces.length, "the text does not end in a newline");
  const lines: OwnPropertyLine[] = [];
  pieces.slice(0, -1).forEach((piece, index) => {
    const lineNumber = index + 1;
    const match = linePattern.exec(piece);
    if (match === null) fail(lineNumber, "malformed line");
    const [, holder, open, properties] = match;
    const previous = lines.at(-1);
    if (previous && compareBytes(previous.holder, holder) >= 0) {
      fail(lineNumber, `${holder} is repeated or out of order`);
    }
    lines.push({ holder, isOpen: open !== undefined, properties: parseProperties(properties, lineNumber) });
  });
  return lines;
}

export function formatAttributes(attributes: OwnProperty["attributes"]): string {
  if (attributes === null) return "?";
  const { isAccessor, isWritable, isConfigurable } = attributes;
  return (isAccessor ? "a" : "") + (isWritable ? "w" : "") + (isConfigurable ? "c" : "") || "-";
}

export function formatOwnProperties(lines: readonly OwnPropertyLine[]): string {
  const sortedLines = lines.toSorted((left, right) => compareBytes(left.holder, right.holder));
  return sortedLines
    .map(({ holder, isOpen, properties }) => {
      const sortedProperties = properties.toSorted((left, right) => compareBytes(left.name, right.name));
      const entries = sortedProperties.map(
        ({ name, attributes, isCreatedInSomeRuns }) =>
          ` ${name}/${isCreatedInSomeRuns ? createdInSomeRunsMark : formatAttributes(attributes)}`,
      );
      return `${holder}${isOpen ? " open" : ""} :${entries.join("")}\n`;
    })
    .join("");
}

function isFixedProperty({ attributes }: OwnProperty): boolean {
  return attributes !== null && !attributes.isAccessor && !attributes.isWritable && !attributes.isConfigurable;
}

function declareOwnProperties({ holder, isOpen, properties }: OwnPropertyLine): Declaration[] {
  return [
    {
      declares: "OwnProperties",
      holder,
      isOpen,
      properties: properties.map(property => ({
        name: property.name,
        isAccessor: property.attributes?.isAccessor ?? false,
        isFixed: isFixedProperty(property),
        isCreatedInSomeRuns: property.isCreatedInSomeRuns,
      })),
    },
    ...properties.filter(isFixedProperty).map(({ name }): Declaration => ({
      declares: "Extension",
      path: memberPathOf(holder, name),
      columns: { mutability: "AlwaysLocked" },
    })),
  ];
}

/** `file` is relative to `root`, which is the tree of the host. */
export function collectOwnProperties(root: string, file: string, problems: Problems): SourcedDeclaration[] {
  let lines: OwnPropertyLine[];
  try {
    lines = parseOwnProperties(readFileSync(path.join(root, file), "utf8"));
  } catch (error) {
    if (!(error instanceof GeneratorError)) throw error;
    problems.add(null, `${file}: ${error.message}`);
    return [];
  }
  return lines.flatMap((line, index) =>
    declareOwnProperties(line).map(declaration => ({
      declaration,
      source: { file, line: index + 1, origin: "Host", proof: "Structure" } as const,
    })),
  );
}
