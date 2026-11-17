// Writes one application in several languages and dresses, for run.ts to time their compilers on.
//
//   bun bench/compiler/generate.ts <folder> <modules> <dress>
//
// The application is a service of <modules> features. A feature has a record, a parser and a printer of text with an error path, JSON in and out, a registry over a map,
// an interface with a few implementations, routes in a shared HTTP router, and a subcommand for a shared command line parser. It uses two earlier features.
// `describe(index)` says what a feature looks like: how many fields of which types, how many shapes, which numbers. Every writer below renders that one description in the idiom of its language.
// Every program prints the same number: `bun bench/compiler/run.ts --check` holds them to it.
//
// Dresses: typed (.ts) | erased (the same as .js, no types) | mixed (every other feature .js) | packages-typed (features as packages in node_modules: .js with .d.ts) | packages-untyped | go | rust
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type FieldType = "int" | "text" | "flag" | "texts" | "maybeInt";
export interface Field {
  name: string;
  type: FieldType;
}
export interface Feature {
  index: number;
  fields: Field[];
  shapes: { name: string; extra: number }[];
  limits: [number, number];
  weights: [number, number, number];
  uses: number[];
  rows: string[];
  badRow: string;
}

export const modulus = 1000003;

// A small generator of numbers that gives the same ones everywhere.
function numbers(seed: number) {
  let state = (seed * 2654435761 + 12345) >>> 0;
  return (below: number) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return (state >>> 8) % below;
  };
}

export function describe(index: number): Feature {
  const next = numbers(index + 1);
  const types: FieldType[] = ["int", "text", "flag", "texts", "maybeInt"];
  const fields: Field[] = [
    { name: "id", type: "int" },
    { name: "name", type: "text" },
  ];
  for (let extra = 0, count = 2 + next(5); extra < count; extra++)
    fields.push({ name: `f${extra}`, type: types[next(types.length)] });
  const shapes = Array.from({ length: 2 + next(3) }, (_, shape) => ({ name: `Shape${shape}`, extra: next(9) }));
  const cell = (field: Field, row: number) => {
    switch (field.type) {
      case "int":
        return field.name === "id" ? String(row + 1) : String(next(1000));
      case "text":
        return field.name === "name" ? `n${index}x${row}` : `t${next(100)}`;
      case "flag":
        return next(2) ? "1" : "0";
      case "texts":
        return Array.from({ length: next(3) }, () => `g${next(10)}`).join("|");
      case "maybeInt":
        return next(2) ? String(next(50)) : "";
    }
  };
  const rows = Array.from({ length: 3 }, (_, row) => fields.map(field => cell(field, row)).join(","));
  return {
    index,
    fields,
    shapes,
    limits: [10 + next(10), 100 + next(50)],
    weights: [1 + next(5), 2 + next(7), 3 + next(11)],
    // A tree, not a row: feature n on feature n - 1 would be a chain of imports as long as the program, which no application has and which lets `go build` compile one package at a time.
    uses: index === 0 ? [] : [...new Set([index >> 1, index >> 3])],
    rows,
    badRow: next(2) ? "x," + rows[0].split(",").slice(1).join(",") : "1,short",
  };
}

type Files = Record<string, string>;

// ---------------------------------------------------------------------------------------------------------------------------------------------------- TypeScript and JavaScript

function script(feature: Feature, typed: boolean, pathOf: (what: string) => string): string {
  const { index, fields, shapes, limits, weights, uses } = feature;
  const T = (text: string) => (typed ? text : "");
  const typeOf: Record<FieldType, string> = {
    int: "number",
    text: "string",
    flag: "boolean",
    texts: "string[]",
    maybeInt: "number",
  };
  const parseCell = (field: Field, position: number) => {
    const part = `parts[${position}]`;
    switch (field.type) {
      case "int":
        return `${field.name}: integer(${part}, line)`;
      case "text":
        return `${field.name}: ${part}`;
      case "flag":
        return `${field.name}: ${part} === "1"`;
      case "texts":
        return `${field.name}: ${part} === "" ? [] : ${part}.split("|")`;
      case "maybeInt":
        return `${field.name}: ${part} === "" ? undefined : integer(${part}, line)`;
    }
  };
  const printCell = (field: Field) => {
    switch (field.type) {
      case "int":
      case "text":
        return `item.${field.name}`;
      case "flag":
        return `item.${field.name} ? "1" : "0"`;
      case "texts":
        return `item.${field.name}.join("|")`;
      case "maybeInt":
        return `item.${field.name} ?? ""`;
    }
  };
  const weigh = (field: Field) => {
    switch (field.type) {
      case "int":
        return `item.${field.name}`;
      case "text":
        return `item.${field.name}.length`;
      case "flag":
        return `(item.${field.name} ? 1 : 0)`;
      case "texts":
        return `item.${field.name}.length`;
      case "maybeInt":
        return `(item.${field.name} ?? 7)`;
    }
  };
  const isField = (field: Field) => {
    const value = `value.${field.name}`;
    switch (field.type) {
      case "int":
        return `typeof ${value} === "number"`;
      case "text":
        return `typeof ${value} === "string"`;
      case "flag":
        return `typeof ${value} === "boolean"`;
      case "texts":
        return `Array.isArray(${value})`;
      case "maybeInt":
        return `(${value} === undefined || typeof ${value} === "number")`;
    }
  };
  return `import { ${typed ? "type Command, type Feature, " : ""}flagOf } from "${pathOf("flags")}";
import { ${typed ? "type Router, " : ""}text } from "${pathOf("router")}";
import { hash, isInteger } from "${pathOf("text")}";
${uses.map(used => `import { describe as describe${used} } from "${pathOf(`feature${used}`)}";`).join("\n")}
${T(`
export interface Item {
${fields.map(field => `  ${field.name}${field.type === "maybeInt" ? "?" : ""}: ${typeOf[field.type]};`).join("\n")}
}

export type Kind = "small" | "medium" | "large";

export interface Shape {
  area(): number;
  label(): string;
}
`)}
export class ParseError extends Error {
  ${T("readonly line: number;\n  ")}constructor(line${T(": number")}, reason${T(": string")}) {
    super(\`feature${index}:\${line}: \${reason}\`);
    this.name = "ParseError";
    this.line = line;
  }
}

function integer(part${T(": string")}, line${T(": number")})${T(": number")} {
  if (!isInteger(part)) throw new ParseError(line, \`not a number: \${part}\`);
  return Number(part);
}

export function parse(source${T(": string")})${T(": Item[]")} {
  const items${T(": Item[]")} = [];
  let line = 0;
  for (const row of source.split("\\n")) {
    line++;
    if (row === "") continue;
    const parts = row.split(",");
    if (parts.length !== ${fields.length}) throw new ParseError(line, \`\${parts.length} fields\`);
    items.push({
${fields.map((field, position) => `      ${parseCell(field, position)},`).join("\n")}
    });
  }
  return items;
}

export function print(items${T(": Item[]")})${T(": string")} {
  return items.map(item => [${fields.map(printCell).join(", ")}].join(",")).join("\\n");
}

function isItem(value${T(": any")})${T(": value is Item")} {
  return typeof value === "object" && value !== null && ${fields.map(isField).join(" && ")};
}

export function decode(json${T(": string")})${T(": Item[]")} {
  const values${T(": unknown")} = JSON.parse(json);
  if (!Array.isArray(values) || !values.every(isItem)) throw new TypeError("feature${index}: not a list of items");
  return values;
}

export class Registry {
  ${typed ? "private items = new Map<string, Item>();" : "items = new Map();"}

  add(item${T(": Item")})${T(": this")} {
    this.items.set(item.name, item);
    return this;
  }

  find(name${T(": string")})${T(": Item | undefined")} {
    return this.items.get(name);
  }

  names()${T(": string[]")} {
    return [...this.items.keys()].sort();
  }

  weight()${T(": number")} {
    let sum = 0;
    for (const item of this.items.values()) sum += ${fields.map(weigh).join(" + ")};
    return sum;
  }
}
${shapes
  .map(
    (shape, position) => `
export class ${shape.name}${T(" implements Shape")} {
  ${T("readonly width: number;\n  readonly height: number;\n  ")}constructor(width${T(": number")}, height${T(": number")}) {
    this.width = width;
    this.height = height;
  }

  area()${T(": number")} {
    return this.width * this.height + ${shape.extra};
  }

  label()${T(": string")} {
    return \`${shape.name.toLowerCase()}-${position}(\${this.width}x\${this.height})\`;
  }
}
`,
  )
  .join("")}
export function kindOf(shape${T(": Shape")})${T(": Kind")} {
  const area = shape.area();
  if (area < ${limits[0]}) return "small";
  if (area < ${limits[1]}) return "medium";
  return "large";
}

const weights${T(": Record<Kind, number>")} = { small: ${weights[0]}, medium: ${weights[1]}, large: ${weights[2]} };

export function describe(size${T(": number")})${T(": number")} {
  const shapes${T(": Shape[]")} = [${shapes.map((shape, position) => `new ${shape.name}(size + ${position}, ${position + 2})`).join(", ")}];
  let sum = 0;
  for (const shape of shapes) sum += shape.area() * weights[kindOf(shape)] + shape.label().length;
  return sum % ${modulus};
}

const rows = ${JSON.stringify(feature.rows.join("\n"))};
const stored = new Registry();
for (const item of parse(rows)) stored.add(item);

export function register(router${T(": Router")})${T(": void")} {
  router.get("/feature${index}/items/:name", request => {
    const item = stored.find(request.parameters.name);
    return item ? text(200, print([item])) : text(404, \`no item at \${request.path}\`);
  });
  router.get("/feature${index}/names", () => text(200, stored.names().join(",")));
}

export const command${T(": Command")} = {
  name: "feature${index}",
  run(flags, rest) {
    const count = Number(flagOf(flags, "count", "1"));
    let sum = flags.has("verbose") ? ${index % 17} : 0;
    for (let size = 0; size < count; size++) sum += describe(size);
    return (sum + rest.length) % ${modulus};
  },
};

export function run()${T(": number")} {
  const items = parse(rows);
  let sum = stored.weight() + stored.names().join().length + hash(print(items));
  try {
    parse(${JSON.stringify(feature.badRow)});
  } catch (error) {
    if (!(error instanceof ParseError)) throw error;
    sum += error.message.length + error.line;
  }
  const json = JSON.stringify(items);
  sum += hash(json);
  for (const item of decode(json)) sum += item.id;
  sum += describe(${index % 5})${uses.map(used => ` + describe${used}(${(index + used) % 7})`).join("")};
  return sum % ${modulus};
}

export const feature${T(": Feature")} = { register, command, run };
`;
}

function scriptLibrary(typed: boolean): Files {
  const T = (text: string) => (typed ? text : "");
  return {
    text: `export function hash(value${T(": string")})${T(": number")} {
  let sum = 7;
  for (let index = 0; index < value.length; index++) sum = (sum * 31 + value.charCodeAt(index)) % ${modulus};
  return sum;
}

export function isInteger(value${T(": string")})${T(": boolean")} {
  return /^-?[0-9]+$/.test(value);
}
`,
    router: `${T(`export interface Request {
  path: string;
  parameters: Record<string, string>;
}

export interface Response {
  status: number;
  body: string;
}

export type Handler = (request: Request) => Response;

interface Route {
  parts: string[];
  handler: Handler;
}
`)}
export function text(status${T(": number")}, body${T(": string")})${T(": Response")} {
  return { status, body };
}

export class Router {
  ${typed ? "private routes = new Map<string, Route[]>();" : "routes = new Map();"}

  get(pattern${T(": string")}, handler${T(": Handler")})${T(": void")} {
    const parts = pattern.split("/").slice(1);
    const routes = this.routes.get(parts[0]);
    if (routes) routes.push({ parts, handler });
    else this.routes.set(parts[0], [{ parts, handler }]);
  }

  handle(path${T(": string")})${T(": Response")} {
    const parts = path.split("/").slice(1);
    for (const route of this.routes.get(parts[0]) ?? []) {
      if (route.parts.length !== parts.length) continue;
      const parameters${T(": Record<string, string>")} = {};
      const matches = route.parts.every((part, index) => {
        if (part.startsWith(":")) {
          parameters[part.slice(1)] = parts[index];
          return true;
        }
        return part === parts[index];
      });
      if (matches) return route.handler({ path, parameters });
    }
    return text(404, "not found");
  }
}
`,
    flags: `${T(`import type { Router } from "./router";

export interface Command {
  name: string;
  run(flags: Map<string, string>, rest: string[]): number;
}

export interface Feature {
  register(router: Router): void;
  command: Command;
  run(): number;
}
`)}
export class UsageError extends Error {}

export function flagOf(flags${T(": Map<string, string>")}, name${T(": string")}, fallback${T(": string")})${T(": string")} {
  return flags.get(name) ?? fallback;
}

export function dispatch(commands${T(": Map<string, Command>")}, line${T(": string[]")})${T(": number")} {
  const command = commands.get(line[0]);
  if (!command) throw new UsageError(\`unknown command \${line[0]}\`);
  const flags = new Map${T("<string, string>")}();
  const rest${T(": string[]")} = [];
  for (const word of line.slice(1)) {
    if (!word.startsWith("--")) {
      rest.push(word);
      continue;
    }
    const equals = word.indexOf("=");
    if (equals < 0) flags.set(word.slice(2), "");
    else flags.set(word.slice(2, equals), word.slice(equals + 1));
  }
  return command.run(flags, rest);
}
`,
  };
}

function scriptMain(count: number, typed: boolean, pathOf: (what: string) => string): string {
  const all = Array.from({ length: count }, (_, index) => index);
  return `import { ${typed ? "type Command, " : ""}UsageError, dispatch } from "${pathOf("flags")}";
import { Router } from "${pathOf("router")}";
${all.map(index => `import { feature as feature${index} } from "${pathOf(`feature${index}`)}";`).join("\n")}

const features = [${all.map(index => `feature${index}`).join(", ")}];
const router = new Router();
const commands = new Map${typed ? "<string, Command>" : ""}();
for (const feature of features) {
  feature.register(router);
  commands.set(feature.command.name, feature.command);
}

let sum = 0;
features.forEach((feature, index) => {
  sum = (sum + feature.run()) % ${modulus};
  const found = router.handle(\`/feature\${index}/items/n\${index}x1\`);
  const missing = router.handle(\`/feature\${index}/items/nobody\`);
  const names = router.handle(\`/feature\${index}/names\`);
  sum = (sum + found.status + found.body.length + missing.status + missing.body.length + names.body.length) % ${modulus};
  sum = (sum + dispatch(commands, [\`feature\${index}\`, "--count=3", "--verbose", "extra"])) % ${modulus};
});
try {
  dispatch(commands, ["nothing"]);
} catch (error) {
  if (!(error instanceof UsageError)) throw error;
  sum += error.message.length;
}
console.log(sum % ${modulus});
`;
}

function declarations(feature: Feature): string {
  const typeOf: Record<FieldType, string> = {
    int: "number",
    text: "string",
    flag: "boolean",
    texts: "string[]",
    maybeInt: "number",
  };
  return `import type { Command, Feature } from "bench-flags";
import type { Router } from "bench-router";
export interface Item {
${feature.fields.map(field => `  ${field.name}${field.type === "maybeInt" ? "?" : ""}: ${typeOf[field.type]};`).join("\n")}
}
export type Kind = "small" | "medium" | "large";
export interface Shape {
  area(): number;
  label(): string;
}
export declare class ParseError extends Error {
  readonly line: number;
  constructor(line: number, reason: string);
}
export declare function parse(source: string): Item[];
export declare function print(items: Item[]): string;
export declare function decode(json: string): Item[];
export declare class Registry {
  add(item: Item): this;
  find(name: string): Item | undefined;
  names(): string[];
  weight(): number;
}
${feature.shapes.map(shape => `export declare class ${shape.name} implements Shape {\n  readonly width: number;\n  readonly height: number;\n  constructor(width: number, height: number);\n  area(): number;\n  label(): string;\n}`).join("\n")}
export declare function kindOf(shape: Shape): Kind;
export declare function describe(size: number): number;
export declare function register(router: Router): void;
export declare const command: Command;
export declare function run(): number;
export declare const feature: Feature;
`;
}

const libraryDeclarations: Files = {
  text: `export declare function hash(value: string): number;\nexport declare function isInteger(value: string): boolean;\n`,
  router: `export interface Request {\n  path: string;\n  parameters: Record<string, string>;\n}\nexport interface Response {\n  status: number;\n  body: string;\n}\nexport type Handler = (request: Request) => Response;\nexport declare function text(status: number, body: string): Response;\nexport declare class Router {\n  get(pattern: string, handler: Handler): void;\n  handle(path: string): Response;\n}\n`,
  flags: `import type { Router } from "bench-router";\nexport interface Command {\n  name: string;\n  run(flags: Map<string, string>, rest: string[]): number;\n}\nexport interface Feature {\n  register(router: Router): void;\n  command: Command;\n  run(): number;\n}\nexport declare class UsageError extends Error {}\nexport declare function flagOf(flags: Map<string, string>, name: string, fallback: string): string;\nexport declare function dispatch(commands: Map<string, Command>, line: string[]): number;\n`,
};

function scripts(count: number, dress: string): Files {
  const files: Files = {
    "package.json": `{ "name": "bench-application", "private": true, "type": "module" }\n`,
    "tsconfig.json": `{ "compilerOptions": { "target": "ESNext", "module": "ESNext", "moduleResolution": "bundler", "strict": true, "noEmit": true, "allowJs": true, "skipLibCheck": true, "types": [] } }\n`,
  };
  if (dress.startsWith("packages")) {
    const pathOf = (what: string) => `bench-${what}`;
    const pack = (name: string, code: string, types: string) => {
      const withTypes = dress === "packages-typed";
      files[`node_modules/bench-${name}/package.json`] =
        `{ "name": "bench-${name}", "version": "1.0.0", "type": "module", "main": "index.js"${withTypes ? `, "types": "index.d.ts"` : ""} }\n`;
      files[`node_modules/bench-${name}/index.js`] = code;
      if (withTypes) files[`node_modules/bench-${name}/index.d.ts`] = types;
    };
    for (const [name, code] of Object.entries(scriptLibrary(false))) pack(name, code, libraryDeclarations[name]);
    for (let index = 0; index < count; index++)
      pack(`feature${index}`, script(describe(index), false, pathOf), declarations(describe(index)));
    files[dress === "packages-typed" ? "main.ts" : "main.js"] = scriptMain(count, dress === "packages-typed", pathOf);
    return files;
  }
  const isTyped = (index: number) => dress === "typed" || (dress === "mixed" && index % 2 === 0);
  const pathOf = (what: string) => `./${what}`;
  for (const [name, code] of Object.entries(scriptLibrary(dress !== "erased")))
    files[`${name}.${dress === "erased" ? "js" : "ts"}`] = code;
  for (let index = 0; index < count; index++)
    files[`feature${index}.${isTyped(index) ? "ts" : "js"}`] = script(describe(index), isTyped(index), pathOf);
  files[dress === "erased" ? "main.js" : "main.ts"] = scriptMain(count, dress !== "erased", pathOf);
  return files;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------- Go

function goFeature(feature: Feature): string {
  const { index, fields, shapes, limits, weights, uses } = feature;
  const public_ = (name: string) => (name === "id" ? "ID" : name[0].toUpperCase() + name.slice(1));
  const typeOf: Record<FieldType, string> = {
    int: "int",
    text: "string",
    flag: "bool",
    texts: "[]string",
    maybeInt: "*int",
  };
  const hasMaybe = fields.some(field => field.type === "maybeInt");
  const parseCell = (field: Field, position: number) => {
    const part = `parts[${position}]`;
    const target = `item.${public_(field.name)}`;
    switch (field.type) {
      case "int":
        return `\t\tif ${target}, err = integer(${part}, line); err != nil {\n\t\t\treturn nil, err\n\t\t}`;
      case "text":
        return `\t\t${target} = ${part}`;
      case "flag":
        return `\t\t${target} = ${part} == "1"`;
      case "texts":
        return `\t\t${target} = []string{}\n\t\tif ${part} != "" {\n\t\t\t${target} = strings.Split(${part}, "|")\n\t\t}`;
      case "maybeInt":
        return `\t\tif ${part} != "" {\n\t\t\tvalue, err := integer(${part}, line)\n\t\t\tif err != nil {\n\t\t\t\treturn nil, err\n\t\t\t}\n\t\t\t${target} = &value\n\t\t}`;
    }
  };
  const printCell = (field: Field) => {
    const value = `item.${public_(field.name)}`;
    switch (field.type) {
      case "int":
        return `strconv.Itoa(${value})`;
      case "text":
        return value;
      case "flag":
        return `flagText(${value})`;
      case "texts":
        return `strings.Join(${value}, "|")`;
      case "maybeInt":
        return `maybeText(${value})`;
    }
  };
  const weigh = (field: Field) => {
    const value = `item.${public_(field.name)}`;
    switch (field.type) {
      case "int":
        return `\t\tsum += ${value}`;
      case "text":
      case "texts":
        return `\t\tsum += len(${value})`;
      case "flag":
        return `\t\tif ${value} {\n\t\t\tsum++\n\t\t}`;
      case "maybeInt":
        return `\t\tif ${value} != nil {\n\t\t\tsum += *${value}\n\t\t} else {\n\t\t\tsum += 7\n\t\t}`;
    }
  };
  return `// Package feature${index} is one feature of the application.
package feature${index}

import (
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"

${uses.map(used => `\t"bench/application/feature${used}"\n`).join("")}	"bench/application/flags"
	"bench/application/router"
	"bench/application/text"
)

type Item struct {
${fields.map(field => `\t${public_(field.name)} ${typeOf[field.type]} \`json:"${field.name}${field.type === "maybeInt" ? ",omitempty" : ""}"\``).join("\n")}
}

type Kind int

const (
	Small Kind = iota
	Medium
	Large
)

type Shape interface {
	Area() int
	Label() string
}

type ParseError struct {
	Line   int
	Reason string
}

func (e *ParseError) Error() string {
	return fmt.Sprintf("feature${index}:%d: %s", e.Line, e.Reason)
}

func integer(part string, line int) (int, error) {
	if !text.IsInteger(part) {
		return 0, &ParseError{line, "not a number: " + part}
	}
	return strconv.Atoi(part)
}

func Parse(source string) ([]Item, error) {
	items := []Item{}
	for index, row := range strings.Split(source, "\\n") {
		line := index + 1
		if row == "" {
			continue
		}
		parts := strings.Split(row, ",")
		if len(parts) != ${fields.length} {
			return nil, &ParseError{line, fmt.Sprintf("%d fields", len(parts))}
		}
		var item Item
		var err error
${fields.map(parseCell).join("\n")}
		items = append(items, item)
	}
	return items, nil
}
${
  fields.some(field => field.type === "flag")
    ? `
func flagText(value bool) string {
	if value {
		return "1"
	}
	return "0"
}
`
    : ""
}${
    hasMaybe
      ? `
func maybeText(value *int) string {
	if value == nil {
		return ""
	}
	return strconv.Itoa(*value)
}
`
      : ""
  }
func Print(items []Item) string {
	rows := make([]string, len(items))
	for index, item := range items {
		rows[index] = strings.Join([]string{${fields.map(printCell).join(", ")}}, ",")
	}
	return strings.Join(rows, "\\n")
}

func Decode(data string) ([]Item, error) {
	var items []Item
	if err := json.Unmarshal([]byte(data), &items); err != nil {
		return nil, fmt.Errorf("feature${index}: not a list of items: %w", err)
	}
	return items, nil
}

type Registry struct {
	items map[string]Item
}

func NewRegistry() *Registry {
	return &Registry{items: map[string]Item{}}
}

func (r *Registry) Add(item Item) *Registry {
	r.items[item.Name] = item
	return r
}

func (r *Registry) Find(name string) (Item, bool) {
	item, ok := r.items[name]
	return item, ok
}

func (r *Registry) Names() []string {
	names := make([]string, 0, len(r.items))
	for name := range r.items {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}

func (r *Registry) Weight() int {
	sum := 0
	for _, item := range r.items {
${fields.map(weigh).join("\n")}
	}
	return sum
}
${shapes
  .map(
    (shape, position) => `
type ${shape.name} struct {
	Width, Height int
}

func (s ${shape.name}) Area() int {
	return s.Width*s.Height + ${shape.extra}
}

func (s ${shape.name}) Label() string {
	return fmt.Sprintf("${shape.name.toLowerCase()}-${position}(%dx%d)", s.Width, s.Height)
}
`,
  )
  .join("")}
func KindOf(shape Shape) Kind {
	switch area := shape.Area(); {
	case area < ${limits[0]}:
		return Small
	case area < ${limits[1]}:
		return Medium
	default:
		return Large
	}
}

var weights = [...]int{Small: ${weights[0]}, Medium: ${weights[1]}, Large: ${weights[2]}}

func Describe(size int) int {
	shapes := []Shape{${shapes.map((shape, position) => `${shape.name}{size + ${position}, ${position + 2}}`).join(", ")}}
	sum := 0
	for _, shape := range shapes {
		sum += shape.Area()*weights[KindOf(shape)] + len(shape.Label())
	}
	return sum % ${modulus}
}

const rows = ${JSON.stringify(feature.rows.join("\n"))}

var stored = func() *Registry {
	items, err := Parse(rows)
	if err != nil {
		panic(err)
	}
	registry := NewRegistry()
	for _, item := range items {
		registry.Add(item)
	}
	return registry
}()

func Register(r *router.Router) {
	r.Get("/feature${index}/items/:name", func(request router.Request) router.Response {
		name := request.Parameters["name"]
		if item, ok := stored.Find(name); ok {
			return router.Text(200, Print([]Item{item}))
		}
		return router.Text(404, "no item at "+request.Path)
	})
	r.Get("/feature${index}/names", func(router.Request) router.Response {
		return router.Text(200, strings.Join(stored.Names(), ","))
	})
}

var Command = flags.Command{
	Name: "feature${index}",
	Run: func(set map[string]string, rest []string) int {
		count, _ := strconv.Atoi(flags.Of(set, "count", "1"))
		sum := 0
		if _, verbose := set["verbose"]; verbose {
			sum = ${index % 17}
		}
		for size := 0; size < count; size++ {
			sum += Describe(size)
		}
		return (sum + len(rest)) % ${modulus}
	},
}

func Run() (int, error) {
	items, err := Parse(rows)
	if err != nil {
		return 0, err
	}
	sum := stored.Weight() + len(strings.Join(stored.Names(), ",")) + text.Hash(Print(items))
	var parseError *ParseError
	if _, err := Parse(${JSON.stringify(feature.badRow)}); errors.As(err, &parseError) {
		sum += len(parseError.Error()) + parseError.Line
	} else if err != nil {
		return 0, err
	}
	data, err := json.Marshal(items)
	if err != nil {
		return 0, err
	}
	sum += text.Hash(string(data))
	decoded, err := Decode(string(data))
	if err != nil {
		return 0, err
	}
	for _, item := range decoded {
		sum += item.ID
	}
	sum += Describe(${index % 5})${uses.map(used => ` + feature${used}.Describe(${(index + used) % 7})`).join("")}
	return sum % ${modulus}, nil
}
`;
}

function go(count: number): Files {
  const all = Array.from({ length: count }, (_, index) => index);
  const files: Files = {
    "go.mod": "module bench/application\n\ngo 1.22\n",
    "text/text.go": `// Package text has what the features share for texts.
package text

func Hash(value string) int {
	sum := 7
	for index := 0; index < len(value); index++ {
		sum = (sum*31 + int(value[index])) % ${modulus}
	}
	return sum
}

func IsInteger(value string) bool {
	if len(value) > 0 && value[0] == '-' {
		value = value[1:]
	}
	if value == "" {
		return false
	}
	for _, digit := range value {
		if digit < '0' || digit > '9' {
			return false
		}
	}
	return true
}
`,
    "router/router.go": `// Package router finds the handler of a path.
package router

import "strings"

type Request struct {
	Path       string
	Parameters map[string]string
}

type Response struct {
	Status int
	Body   string
}

type Handler func(Request) Response

type route struct {
	parts   []string
	handler Handler
}

type Router struct {
	routes map[string][]route
}

func New() *Router {
	return &Router{routes: map[string][]route{}}
}

func Text(status int, body string) Response {
	return Response{status, body}
}

func (r *Router) Get(pattern string, handler Handler) {
	parts := strings.Split(pattern, "/")[1:]
	r.routes[parts[0]] = append(r.routes[parts[0]], route{parts, handler})
}

func (r *Router) Handle(path string) Response {
	parts := strings.Split(path, "/")[1:]
next:
	for _, route := range r.routes[parts[0]] {
		if len(route.parts) != len(parts) {
			continue
		}
		parameters := map[string]string{}
		for index, part := range route.parts {
			if name, ok := strings.CutPrefix(part, ":"); ok {
				parameters[name] = parts[index]
			} else if part != parts[index] {
				continue next
			}
		}
		return route.handler(Request{path, parameters})
	}
	return Text(404, "not found")
}
`,
    "flags/flags.go": `// Package flags reads a command line.
package flags

import "strings"

type Command struct {
	Name string
	Run  func(set map[string]string, rest []string) int
}

type UsageError struct {
	Command string
}

func (e *UsageError) Error() string {
	return "unknown command " + e.Command
}

func Of(set map[string]string, name, fallback string) string {
	if value, ok := set[name]; ok {
		return value
	}
	return fallback
}

func Dispatch(commands map[string]Command, line []string) (int, error) {
	command, ok := commands[line[0]]
	if !ok {
		return 0, &UsageError{line[0]}
	}
	set := map[string]string{}
	rest := []string{}
	for _, word := range line[1:] {
		flag, ok := strings.CutPrefix(word, "--")
		if !ok {
			rest = append(rest, word)
			continue
		}
		name, value, _ := strings.Cut(flag, "=")
		set[name] = value
	}
	return command.Run(set, rest), nil
}
`,
    "main.go": `package main

import (
	"errors"
	"fmt"
	"os"

${all.map(index => `\t"bench/application/feature${index}"\n`).join("")}	"bench/application/flags"
	"bench/application/router"
)

type feature struct {
	register func(*router.Router)
	command  flags.Command
	run      func() (int, error)
}

var features = []feature{
${all.map(index => `\t{feature${index}.Register, feature${index}.Command, feature${index}.Run},\n`).join("")}}

func run() (int, error) {
	routes := router.New()
	commands := map[string]flags.Command{}
	for _, feature := range features {
		feature.register(routes)
		commands[feature.command.Name] = feature.command
	}
	sum := 0
	for index, feature := range features {
		value, err := feature.run()
		if err != nil {
			return 0, err
		}
		sum = (sum + value) % ${modulus}
		found := routes.Handle(fmt.Sprintf("/feature%d/items/n%dx1", index, index))
		missing := routes.Handle(fmt.Sprintf("/feature%d/items/nobody", index))
		names := routes.Handle(fmt.Sprintf("/feature%d/names", index))
		sum = (sum + found.Status + len(found.Body) + missing.Status + len(missing.Body) + len(names.Body)) % ${modulus}
		value, err = flags.Dispatch(commands, []string{fmt.Sprintf("feature%d", index), "--count=3", "--verbose", "extra"})
		if err != nil {
			return 0, err
		}
		sum = (sum + value) % ${modulus}
	}
	var usage *flags.UsageError
	if _, err := flags.Dispatch(commands, []string{"nothing"}); errors.As(err, &usage) {
		sum += len(usage.Error())
	}
	return sum % ${modulus}, nil
}

func main() {
	sum, err := run()
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fmt.Println(sum)
}
`,
  };
  for (const index of all) files[`feature${index}/feature${index}.go`] = goFeature(describe(index));
  return files;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------- Rust

function rustFeature(feature: Feature): string {
  const { index, fields, shapes, limits, weights, uses } = feature;
  const typeOf: Record<FieldType, string> = {
    int: "i64",
    text: "String",
    flag: "bool",
    texts: "Vec<String>",
    maybeInt: "Option<i64>",
  };
  const parseCell = (field: Field, position: number) => {
    const part = `parts[${position}]`;
    switch (field.type) {
      case "int":
        return `integer(${part}, line)?`;
      case "text":
        return `${part}.to_string()`;
      case "flag":
        return `${part} == "1"`;
      case "texts":
        return `if ${part}.is_empty() { Vec::new() } else { ${part}.split('|').map(str::to_string).collect() }`;
      case "maybeInt":
        return `if ${part}.is_empty() { None } else { Some(integer(${part}, line)?) }`;
    }
  };
  const printCell = (field: Field) => {
    const value = `item.${field.name}`;
    switch (field.type) {
      case "int":
        return `${value}.to_string()`;
      case "text":
        return `${value}.clone()`;
      case "flag":
        return `String::from(if ${value} { "1" } else { "0" })`;
      case "texts":
        return `${value}.join("|")`;
      case "maybeInt":
        return `${value}.map_or_else(String::new, |value| value.to_string())`;
    }
  };
  const weigh = (field: Field) => {
    const value = `item.${field.name}`;
    switch (field.type) {
      case "int":
        return value;
      case "text":
      case "texts":
        return `${value}.len() as i64`;
      case "flag":
        return `i64::from(${value})`;
      case "maybeInt":
        return `${value}.unwrap_or(7)`;
    }
  };
  const encodeCell = (field: Field) => {
    const value = `self.${field.name}`;
    const push = (made: string) => `        members.push(("${field.name}".to_string(), ${made}));`;
    switch (field.type) {
      case "int":
        return push(`Value::Number(${value})`);
      case "text":
        return push(`Value::Text(${value}.clone())`);
      case "flag":
        return push(`Value::Bool(${value})`);
      case "texts":
        return push(`Value::List(${value}.iter().cloned().map(Value::Text).collect())`);
      case "maybeInt":
        return `        if let Some(value) = ${value} {\n            members.push(("${field.name}".to_string(), Value::Number(value)));\n        }`;
    }
  };
  const decodeCell = (field: Field) => {
    const member = `value.get("${field.name}")`;
    switch (field.type) {
      case "int":
        return `${member}?.as_number()?`;
      case "text":
        return `${member}?.as_text()?.to_string()`;
      case "flag":
        return `${member}?.as_bool()?`;
      case "texts":
        return `${member}?.as_list()?.iter().map(|text| text.as_text().map(str::to_string)).collect::<Option<_>>()?`;
      case "maybeInt":
        return `match ${member} {\n                Some(value) => Some(value.as_number()?),\n                None => None,\n            }`;
    }
  };
  return `//! One feature of the application.
use std::collections::HashMap;
use std::error::Error;
use std::fmt;
use std::sync::LazyLock;

${uses.map(used => `use crate::feature${used};\n`).join("")}use crate::flags::{self, Command};
use crate::json::{self, Value};
use crate::router::{self, Router};
use crate::text;

#[derive(Debug, Clone, PartialEq)]
pub struct Item {
${fields.map(field => `    pub ${field.name}: ${typeOf[field.type]},`).join("\n")}
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Small,
    Medium,
    Large,
}

pub trait Shape {
    fn area(&self) -> i64;
    fn label(&self) -> String;
}

#[derive(Debug)]
pub struct ParseError {
    pub line: usize,
    pub reason: String,
}

impl fmt::Display for ParseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "feature${index}:{}: {}", self.line, self.reason)
    }
}

impl Error for ParseError {}

fn integer(part: &str, line: usize) -> Result<i64, ParseError> {
    if !text::is_integer(part) {
        return Err(ParseError { line, reason: format!("not a number: {part}") });
    }
    part.parse().map_err(|_| ParseError { line, reason: format!("too large: {part}") })
}

pub fn parse(source: &str) -> Result<Vec<Item>, ParseError> {
    let mut items = Vec::new();
    for (index, row) in source.split('\\n').enumerate() {
        let line = index + 1;
        if row.is_empty() {
            continue;
        }
        let parts: Vec<&str> = row.split(',').collect();
        if parts.len() != ${fields.length} {
            return Err(ParseError { line, reason: format!("{} fields", parts.len()) });
        }
        items.push(Item {
${fields.map((field, position) => `            ${field.name}: ${parseCell(field, position)},`).join("\n")}
        });
    }
    Ok(items)
}

pub fn print(items: &[Item]) -> String {
    let rows: Vec<String> = items.iter().map(|item| [${fields.map(printCell).join(", ")}].join(",")).collect();
    rows.join("\\n")
}

impl Item {
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
${fields.map(encodeCell).join("\n")}
        Value::Object(members)
    }

    fn from_json(value: &Value) -> Option<Item> {
        Some(Item {
${fields.map(field => `            ${field.name}: ${decodeCell(field)},`).join("\n")}
        })
    }
}

pub fn encode(items: &[Item]) -> String {
    Value::List(items.iter().map(Item::to_json).collect()).to_string()
}

pub fn decode(data: &str) -> Result<Vec<Item>, String> {
    let wrong = || "feature${index}: not a list of items".to_string();
    let value = json::parse(data).ok_or_else(wrong)?;
    value.as_list().ok_or_else(wrong)?.iter().map(Item::from_json).collect::<Option<_>>().ok_or_else(wrong)
}

#[derive(Default)]
pub struct Registry {
    items: HashMap<String, Item>,
}

impl Registry {
    pub fn add(&mut self, item: Item) -> &mut Self {
        self.items.insert(item.name.clone(), item);
        self
    }

    pub fn find(&self, name: &str) -> Option<&Item> {
        self.items.get(name)
    }

    pub fn names(&self) -> Vec<&str> {
        let mut names: Vec<&str> = self.items.keys().map(String::as_str).collect();
        names.sort_unstable();
        names
    }

    pub fn weight(&self) -> i64 {
        self.items.values().map(|item| ${fields.map(weigh).join(" + ")}).sum()
    }
}
${shapes
  .map(
    (shape, position) => `
pub struct ${shape.name} {
    pub width: i64,
    pub height: i64,
}

impl Shape for ${shape.name} {
    fn area(&self) -> i64 {
        self.width * self.height + ${shape.extra}
    }

    fn label(&self) -> String {
        format!("${shape.name.toLowerCase()}-${position}({}x{})", self.width, self.height)
    }
}
`,
  )
  .join("")}
pub fn kind_of(shape: &dyn Shape) -> Kind {
    match shape.area() {
        area if area < ${limits[0]} => Kind::Small,
        area if area < ${limits[1]} => Kind::Medium,
        _ => Kind::Large,
    }
}

fn weight_of(kind: Kind) -> i64 {
    match kind {
        Kind::Small => ${weights[0]},
        Kind::Medium => ${weights[1]},
        Kind::Large => ${weights[2]},
    }
}

pub fn describe(size: i64) -> i64 {
    let shapes: Vec<Box<dyn Shape>> = vec![${shapes.map((shape, position) => `Box::new(${shape.name} { width: size + ${position}, height: ${position + 2} })`).join(", ")}];
    let sum: i64 = shapes.iter().map(|shape| shape.area() * weight_of(kind_of(shape.as_ref())) + shape.label().len() as i64).sum();
    sum % ${modulus}
}

const ROWS: &str = ${JSON.stringify(feature.rows.join("\n"))};

static STORED: LazyLock<Registry> = LazyLock::new(|| {
    let mut registry = Registry::default();
    for item in parse(ROWS).expect("the rows of this feature are well formed") {
        registry.add(item);
    }
    registry
});

pub fn register(router: &mut Router) {
    router.get("/feature${index}/items/:name", |request| {
        let name = &request.parameters["name"];
        match STORED.find(name) {
            Some(item) => router::text(200, print(std::slice::from_ref(item))),
            None => router::text(404, format!("no item at {}", request.path)),
        }
    });
    router.get("/feature${index}/names", |_| router::text(200, STORED.names().join(",")));
}

pub fn command() -> Command {
    Command {
        name: "feature${index}",
        run: |set, rest| {
            let count: i64 = flags::of(set, "count", "1").parse().unwrap_or(0);
            let verbose = if set.contains_key("verbose") { ${index % 17} } else { 0 };
            let sum: i64 = verbose + (0..count).map(describe).sum::<i64>();
            (sum + rest.len() as i64) % ${modulus}
        },
    }
}

pub fn run() -> Result<i64, Box<dyn Error>> {
    let items = parse(ROWS)?;
    let mut sum = STORED.weight() + STORED.names().join(",").len() as i64 + text::hash(&print(&items));
    if let Err(error) = parse(${JSON.stringify(feature.badRow)}) {
        sum += error.to_string().len() as i64 + error.line as i64;
    }
    let data = encode(&items);
    sum += text::hash(&data);
    sum += decode(&data)?.iter().map(|item| item.id).sum::<i64>();
    sum += describe(${index % 5})${uses.map(used => ` + feature${used}::describe(${(index + used) % 7})`).join("")};
    Ok(sum % ${modulus})
}
`;
}

function rust(count: number): Files {
  const all = Array.from({ length: count }, (_, index) => index);
  const files: Files = {
    "Cargo.toml": `[package]\nname = "application"\nversion = "1.0.0"\nedition = "2021"\n\n[workspace]\n`,
    "src/text.rs": `//! What the features share for texts.
pub fn hash(value: &str) -> i64 {
    value.bytes().fold(7, |sum, byte| (sum * 31 + i64::from(byte)) % ${modulus})
}

pub fn is_integer(value: &str) -> bool {
    let digits = value.strip_prefix('-').unwrap_or(value);
    !digits.is_empty() && digits.bytes().all(|byte| byte.is_ascii_digit())
}
`,
    "src/json.rs": `//! JSON, as far as the application needs it: the standard library has none.
use std::fmt;

#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    Null,
    Bool(bool),
    Number(i64),
    Text(String),
    List(Vec<Value>),
    Object(Vec<(String, Value)>),
}

impl Value {
    pub fn get(&self, name: &str) -> Option<&Value> {
        match self {
            Value::Object(members) => members.iter().find(|(key, _)| key == name).map(|(_, value)| value),
            _ => None,
        }
    }

    pub fn as_number(&self) -> Option<i64> {
        if let Value::Number(value) = self { Some(*value) } else { None }
    }

    pub fn as_bool(&self) -> Option<bool> {
        if let Value::Bool(value) = self { Some(*value) } else { None }
    }

    pub fn as_text(&self) -> Option<&str> {
        if let Value::Text(value) = self { Some(value) } else { None }
    }

    pub fn as_list(&self) -> Option<&[Value]> {
        if let Value::List(values) = self { Some(values) } else { None }
    }
}

fn write_text(f: &mut fmt::Formatter<'_>, text: &str) -> fmt::Result {
    f.write_str("\\"")?;
    for character in text.chars() {
        match character {
            '"' => f.write_str("\\\\\\"")?,
            '\\\\' => f.write_str("\\\\\\\\")?,
            _ => write!(f, "{character}")?,
        }
    }
    f.write_str("\\"")
}

impl fmt::Display for Value {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Value::Null => f.write_str("null"),
            Value::Bool(value) => write!(f, "{value}"),
            Value::Number(value) => write!(f, "{value}"),
            Value::Text(value) => write_text(f, value),
            Value::List(values) => {
                f.write_str("[")?;
                for (index, value) in values.iter().enumerate() {
                    if index > 0 {
                        f.write_str(",")?;
                    }
                    write!(f, "{value}")?;
                }
                f.write_str("]")
            }
            Value::Object(members) => {
                f.write_str("{")?;
                for (index, (name, value)) in members.iter().enumerate() {
                    if index > 0 {
                        f.write_str(",")?;
                    }
                    write_text(f, name)?;
                    write!(f, ":{value}")?;
                }
                f.write_str("}")
            }
        }
    }
}

struct Parser<'a> {
    bytes: &'a [u8],
    at: usize,
}

impl Parser<'_> {
    fn take(&mut self, byte: u8) -> bool {
        let found = self.bytes.get(self.at) == Some(&byte);
        self.at += usize::from(found);
        found
    }

    fn word(&mut self, word: &str, value: Value) -> Option<Value> {
        self.bytes[self.at..].starts_with(word.as_bytes()).then(|| {
            self.at += word.len();
            value
        })
    }

    fn text(&mut self) -> Option<String> {
        if !self.take(b'"') {
            return None;
        }
        let mut text = Vec::new();
        loop {
            let byte = *self.bytes.get(self.at)?;
            self.at += 1;
            match byte {
                b'"' => return String::from_utf8(text).ok(),
                b'\\\\' => {
                    text.push(*self.bytes.get(self.at)?);
                    self.at += 1;
                }
                _ => text.push(byte),
            }
        }
    }

    fn value(&mut self) -> Option<Value> {
        match *self.bytes.get(self.at)? {
            b'n' => self.word("null", Value::Null),
            b't' => self.word("true", Value::Bool(true)),
            b'f' => self.word("false", Value::Bool(false)),
            b'"' => self.text().map(Value::Text),
            b'[' => {
                self.at += 1;
                let mut values = Vec::new();
                if self.take(b']') {
                    return Some(Value::List(values));
                }
                loop {
                    values.push(self.value()?);
                    if self.take(b']') {
                        return Some(Value::List(values));
                    }
                    if !self.take(b',') {
                        return None;
                    }
                }
            }
            b'{' => {
                self.at += 1;
                let mut members = Vec::new();
                if self.take(b'}') {
                    return Some(Value::Object(members));
                }
                loop {
                    let name = self.text()?;
                    if !self.take(b':') {
                        return None;
                    }
                    members.push((name, self.value()?));
                    if self.take(b'}') {
                        return Some(Value::Object(members));
                    }
                    if !self.take(b',') {
                        return None;
                    }
                }
            }
            _ => {
                let start = self.at;
                self.take(b'-');
                while self.bytes.get(self.at).is_some_and(u8::is_ascii_digit) {
                    self.at += 1;
                }
                std::str::from_utf8(&self.bytes[start..self.at]).ok()?.parse().ok().map(Value::Number)
            }
        }
    }
}

pub fn parse(data: &str) -> Option<Value> {
    let mut parser = Parser { bytes: data.as_bytes(), at: 0 };
    let value = parser.value()?;
    (parser.at == data.len()).then_some(value)
}
`,
    "src/router.rs": `//! Finds the handler of a path.
use std::collections::HashMap;

pub struct Request {
    pub path: String,
    pub parameters: HashMap<String, String>,
}

pub struct Response {
    pub status: i64,
    pub body: String,
}

type Handler = Box<dyn Fn(&Request) -> Response>;

struct Route {
    parts: Vec<String>,
    handler: Handler,
}

#[derive(Default)]
pub struct Router {
    routes: HashMap<String, Vec<Route>>,
}

pub fn text(status: i64, body: impl Into<String>) -> Response {
    Response { status, body: body.into() }
}

impl Router {
    pub fn get(&mut self, pattern: &str, handler: impl Fn(&Request) -> Response + 'static) {
        let parts: Vec<String> = pattern.split('/').skip(1).map(str::to_string).collect();
        self.routes.entry(parts[0].clone()).or_default().push(Route { parts, handler: Box::new(handler) });
    }

    pub fn handle(&self, path: &str) -> Response {
        let parts: Vec<&str> = path.split('/').skip(1).collect();
        'next: for route in self.routes.get(parts[0]).map_or(&[][..], Vec::as_slice) {
            if route.parts.len() != parts.len() {
                continue;
            }
            let mut parameters = HashMap::new();
            for (part, given) in route.parts.iter().zip(&parts) {
                match part.strip_prefix(':') {
                    Some(name) => {
                        parameters.insert(name.to_string(), given.to_string());
                    }
                    None if part != given => continue 'next,
                    None => {}
                }
            }
            return (route.handler)(&Request { path: path.to_string(), parameters });
        }
        text(404, "not found")
    }
}
`,
    "src/flags.rs": `//! Reads a command line.
use std::collections::HashMap;
use std::error::Error;
use std::fmt;

pub struct Command {
    pub name: &'static str,
    pub run: fn(&HashMap<String, String>, &[String]) -> i64,
}

#[derive(Debug)]
pub struct UsageError {
    pub command: String,
}

impl fmt::Display for UsageError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "unknown command {}", self.command)
    }
}

impl Error for UsageError {}

pub fn of<'a>(set: &'a HashMap<String, String>, name: &str, fallback: &'a str) -> &'a str {
    set.get(name).map_or(fallback, String::as_str)
}

pub fn dispatch(commands: &HashMap<&str, Command>, line: &[&str]) -> Result<i64, UsageError> {
    let command = commands.get(line[0]).ok_or_else(|| UsageError { command: line[0].to_string() })?;
    let mut set = HashMap::new();
    let mut rest = Vec::new();
    for word in &line[1..] {
        match word.strip_prefix("--") {
            Some(flag) => {
                let (name, value) = flag.split_once('=').unwrap_or((flag, ""));
                set.insert(name.to_string(), value.to_string());
            }
            None => rest.push(word.to_string()),
        }
    }
    Ok((command.run)(&set, &rest))
}
`,
    "src/main.rs": `${all.map(index => `mod feature${index};\n`).join("")}mod flags;
mod json;
mod router;
mod text;

use std::collections::HashMap;
use std::error::Error;

use flags::Command;
use router::Router;

struct Feature {
    register: fn(&mut Router),
    command: fn() -> Command,
    run: fn() -> Result<i64, Box<dyn Error>>,
}

const FEATURES: &[Feature] = &[
${all.map(index => `    Feature { register: feature${index}::register, command: feature${index}::command, run: feature${index}::run },\n`).join("")}];

fn run() -> Result<i64, Box<dyn Error>> {
    let mut router = Router::default();
    let mut commands = HashMap::new();
    for feature in FEATURES {
        (feature.register)(&mut router);
        let command = (feature.command)();
        commands.insert(command.name, command);
    }
    let mut sum = 0;
    for (index, feature) in FEATURES.iter().enumerate() {
        sum = (sum + (feature.run)()?) % ${modulus};
        let found = router.handle(&format!("/feature{index}/items/n{index}x1"));
        let missing = router.handle(&format!("/feature{index}/items/nobody"));
        let names = router.handle(&format!("/feature{index}/names"));
        sum = (sum + found.status + found.body.len() as i64 + missing.status + missing.body.len() as i64 + names.body.len() as i64) % ${modulus};
        sum = (sum + flags::dispatch(&commands, &[&format!("feature{index}"), "--count=3", "--verbose", "extra"])?) % ${modulus};
    }
    if let Err(error) = flags::dispatch(&commands, &["nothing"]) {
        sum += error.to_string().len() as i64;
    }
    Ok(sum % ${modulus})
}

fn main() -> Result<(), Box<dyn Error>> {
    println!("{}", run()?);
    Ok(())
}
`,
  };
  for (const index of all) files[`src/feature${index}.rs`] = rustFeature(describe(index));
  return files;
}

export function generate(count: number, dress: string): Files {
  if (dress === "go") return go(count);
  if (dress === "rust") return rust(count);
  return scripts(count, dress);
}

export function write(folder: string, files: Files) {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(folder, path)), { recursive: true });
    writeFileSync(join(folder, path), text);
  }
}

if (import.meta.main) {
  const [folder, count, dress] = process.argv.slice(2);
  if (!folder || !Number(count) || !dress)
    throw new Error("usage: bun bench/compiler/generate.ts <folder> <modules> <dress>");
  write(folder, generate(Number(count), dress));
}
