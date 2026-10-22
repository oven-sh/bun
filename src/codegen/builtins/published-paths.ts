import { basename, resolve } from "node:path";
import { loadSchemaFile } from "../bindgen-load.ts";
import { cppSymbolOf } from "./collect-bindgen.ts";
import { Problems, symbolsNaming, type Declaration, type SourcedDeclaration } from "./declarations.ts";
import { collectHost } from "./index.ts";
import { compareBytes, holderPathOf, parsePath, textOfPath } from "./paths.ts";
import { targetPlatforms, type BuiltinPath } from "./vocabulary.ts";

const schemaFilePattern = "src/**/*.bind.ts";
const identifierPattern = /^[A-Za-z_$][\w$]*$/;
const [arbitraryTarget] = targetPlatforms;

interface SchemaDeclaration {
  schema: string;
  declaration: Declaration;
}

interface SchemaFunctions {
  exportNamesBySchema: ReadonlyMap<string, ReadonlySet<string>>;
  exportNameBySymbol: ReadonlyMap<string, string>;
}

interface Placements {
  exportNamesBySchema: ReadonlyMap<string, ReadonlySet<string>>;
  exportNameByPath: ReadonlyMap<BuiltinPath, string>;
  classPaths: ReadonlySet<BuiltinPath>;
}

interface PlacedExport {
  schema: string;
  name: string;
  path: BuiltinPath;
}

const bindgenSourceOf = (schemaFile: string): string => `bun=${schemaFile}`;

const comparePlacedExports = (left: PlacedExport, right: PlacedExport): number =>
  compareBytes(left.schema, right.schema) || compareBytes(left.name, right.name) || compareBytes(left.path, right.path);

function findSchemaFiles(bunRoot: string): string[] {
  const files = new Bun.Glob(schemaFilePattern).scanSync({ cwd: bunRoot, absolute: true });
  return Array.from(files, file => resolve(file)).sort(compareBytes);
}

async function collectHostDeclarations(bunRoot: string, schemaFiles: readonly string[]): Promise<SourcedDeclaration[]> {
  const problems = new Problems();
  const declarations = await collectHost(
    {
      bunRoot,
      javaScriptCore: null,
      prebuiltGenerated: null,
      target: arbitraryTarget,
      bindgenSources: schemaFiles.map(bindgenSourceOf),
      typesOnly: [],
    },
    problems,
  );
  problems.throwIfAny();
  return declarations;
}

async function loadSchemaFunctions(schemaFiles: readonly string[]): Promise<SchemaFunctions> {
  const exportNamesBySchema = new Map<string, Set<string>>();
  const exportNameBySymbol = new Map<string, string>();
  for (const schemaFile of schemaFiles) {
    const { functions } = await loadSchemaFile(bindgenSourceOf(schemaFile));
    exportNamesBySchema.set(basename(schemaFile), new Set(functions.map(fn => fn.name)));
    for (const fn of functions) exportNameBySymbol.set(cppSymbolOf(fn), fn.name);
  }
  return { exportNamesBySchema, exportNameBySymbol };
}

function findSchemaDeclarations(
  bunRoot: string,
  schemaFiles: readonly string[],
  declarations: readonly SourcedDeclaration[],
): SchemaDeclaration[] {
  const schemaFileSet = new Set(schemaFiles);
  return declarations.flatMap(({ declaration, source }) => {
    const file = resolve(bunRoot, source.file);
    return schemaFileSet.has(file) ? [{ schema: basename(file), declaration }] : [];
  });
}

function findExportNamesByPath(
  declarations: readonly SourcedDeclaration[],
  exportNameBySymbol: ReadonlyMap<string, string>,
): Map<BuiltinPath, string> {
  const exportNameByPath = new Map<BuiltinPath, string>();
  for (const { declaration } of declarations) {
    if (declaration.declares !== "Member") continue;
    for (const symbol of symbolsNaming(declaration)) {
      const name = exportNameBySymbol.get(symbol);
      if (name !== undefined) exportNameByPath.set(declaration.path, name);
    }
  }
  return exportNameByPath;
}

function findPlacedExport({ schema, declaration }: SchemaDeclaration, placements: Placements): PlacedExport | null {
  if (declaration.declares === "Class") {
    if (declaration.columns.hasConstructor === false) return null;
    return { schema, name: declaration.name, path: declaration.path };
  }
  if (declaration.declares !== "Member" || declaration.kind !== "Function") return null;
  const { path } = declaration;
  const holder = holderPathOf(path);
  if (holder !== null && placements.classPaths.has(holder)) return null;
  const name = placements.exportNameByPath.get(path) ?? parsePath(path).at(-1)!;
  return placements.exportNamesBySchema.get(schema)?.has(name) ? { schema, name, path } : null;
}

function findPublicModules(declarations: readonly SourcedDeclaration[]): Map<string, boolean> {
  const isPublicBySpecifier = new Map<string, boolean>();
  for (const { declaration } of declarations) {
    if (declaration.declares === "Module") isPublicBySpecifier.set(declaration.specifier, declaration.isPublic);
  }
  return isPublicBySpecifier;
}

export async function publishedPathsOf(bunRoot: string): Promise<Map<string, Map<string, string>>> {
  const schemaFiles = findSchemaFiles(bunRoot);
  const declarations = await collectHostDeclarations(bunRoot, schemaFiles);
  const { exportNamesBySchema, exportNameBySymbol } = await loadSchemaFunctions(schemaFiles);
  const schemaDeclarations = findSchemaDeclarations(bunRoot, schemaFiles, declarations);
  const placements: Placements = {
    exportNamesBySchema,
    exportNameByPath: findExportNamesByPath(declarations, exportNameBySymbol),
    classPaths: new Set(
      schemaDeclarations.flatMap(({ declaration }) => (declaration.declares === "Class" ? [declaration.path] : [])),
    ),
  };
  const isPublicBySpecifier = findPublicModules(declarations);
  const published = schemaDeclarations
    .flatMap(schemaDeclaration => findPlacedExport(schemaDeclaration, placements) ?? [])
    .filter(({ path }) => {
      const [root] = parsePath(path);
      return isPublicBySpecifier.get(root) ?? identifierPattern.test(root);
    })
    .sort(comparePlacedExports);

  const pathsBySchema = new Map<string, Map<string, string>>();
  for (const [schema, exports] of Map.groupBy(published, ({ schema }) => schema)) {
    pathsBySchema.set(schema, new Map(exports.map(({ name, path }) => [name, textOfPath(parsePath(path))] as const)));
  }
  return pathsBySchema;
}

function typeQueryOf(pathText: string): string {
  const [root, ...members] = parsePath(pathText);
  if (identifierPattern.test(root)) return `typeof ${pathText}`;
  return [`typeof import(${JSON.stringify(root)})`, ...members].join(".");
}

export function publishedTypeText(paths: ReadonlyMap<string, string>): string | null {
  if (paths.size === 0) return null;
  const members = Array.from(paths, ([name, pathText]) => `${JSON.stringify(name)}: ${typeQueryOf(pathText)};`);
  return `{ ${members.join(" ")} }`;
}
