// Dumps every type that bun-types contributes to a program, with the shape the
// TypeScript checker resolves it to, for several `lib` configurations.
//
// Usage:
//   bun scripts/inventory.ts [--out <dir>] [--preset <name>]... [--check] [--keep]
//
// Each preset writes one file, <out>/<preset>.txt. A symbol is listed when at
// least one of its declarations is in bun-types: the globals, the exports of the
// modules bun-types declares (`bun`, `bun:test`, `*.html`, ...) and of the node
// modules and namespaces it augments (`node:tls`, `NodeJS`). The members of a
// listed symbol are printed in full, wherever they come from. Interface merging,
// `UseLibDomIfAvailable`, and every other conditional alias are resolved, so the
// file shows what a user sees, not what the .d.ts source says. The files are
// plain text sorted by name, so `git diff` on them is the review surface for a
// change to packages/bun-types.
//
// With --check the tool writes nothing. It exits 1 and prints a diff when a
// preset's output differs from the file in <out>.
//
// The default output directory is test/integration/bun-types/inventory.
//
// Not covered: ts7.1/, which only TypeScript 7.1 can parse. This script runs the
// compiler API of the repository's own `typescript` dependency.
import { $ } from "bun";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import ts from "typescript";

const PACKAGE_ROOT = resolve(import.meta.dir, "..");
const REPO_ROOT = resolve(PACKAGE_ROOT, "../..");
const DEFAULT_OUT = join(REPO_ROOT, "test/integration/bun-types/inventory");

const DOM_LIBS = ["lib.dom.d.ts", "lib.dom.iterable.d.ts", "lib.dom.asynciterable.d.ts"];

/**
 * The `lib` matrix. The names are the file names TypeScript ships in its lib/
 * directory. `[]` means no lib at all: @types/node then pulls in es2020 through
 * its own `/// <reference lib>` directives.
 */
const PRESETS: Record<string, { lib: string[] }> = {
  "esnext": { lib: ["lib.esnext.d.ts"] },
  "esnext-dom": { lib: ["lib.esnext.d.ts", ...DOM_LIBS] },
  "es2022": { lib: ["lib.es2022.d.ts"] },
  "es2022-dom": { lib: ["lib.es2022.d.ts", ...DOM_LIBS] },
  "no-lib": { lib: [] },
};

function parseArgs(argv: string[]) {
  const out = { out: DEFAULT_OUT, presets: [] as string[], check: false, keep: false };
  const valueOf = (flag: string, value: string | undefined) => {
    if (value === undefined) throw new Error(`${flag} needs a value`);
    return value;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--out") out.out = resolve(valueOf(arg, argv[++i]));
    else if (arg === "--preset") out.presets.push(valueOf(arg, argv[++i]));
    else if (arg === "--check") out.check = true;
    else if (arg === "--keep") out.keep = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (out.presets.length === 0) out.presets = Object.keys(PRESETS);
  for (const preset of out.presets) {
    if (!(preset in PRESETS)) throw new Error(`unknown preset ${preset}. Known: ${Object.keys(PRESETS).join(", ")}`);
  }
  return out;
}

/** TypeScript reports file names with forward slashes on every platform. */
const toPosix = (path: string) => path.replaceAll("\\", "/");

/**
 * TypeScript resolves files under node_modules to their real path with the
 * native realpath. On Windows only the native one expands 8.3 short names
 * (`C:\Users\RUNNER~1`, which is what `os.tmpdir()` can return), so every path
 * this script compares against a TypeScript file name goes through it too.
 */
const realPathOf = (path: string) => toPosix(realpathSync.native(path));

function readVersion(packageJson: string): string | undefined {
  return existsSync(packageJson) ? JSON.parse(readFileSync(packageJson, "utf8")).version : undefined;
}

/**
 * The versions of @types/node and undici-types that this repository's lockfile
 * installed for packages/bun-types. The scratch project pins both, so the
 * output only changes when bun-types or that lockfile changes.
 */
function pinnedDependencies(): string[] {
  const nodeTypesDir = join(PACKAGE_ROOT, "node_modules", "@types", "node");
  const nodeTypesVersion = readVersion(join(nodeTypesDir, "package.json"));
  if (!nodeTypesVersion) {
    throw new Error(`@types/node is not installed in ${nodeTypesDir}. Run \`bun install\` in the repository first.`);
  }
  const pins = [`@types/node@${nodeTypesVersion}`];
  // undici-types is a dependency of @types/node, so resolve it from there.
  const requireFromNodeTypes = createRequire(join(realpathSync.native(nodeTypesDir), "index.d.ts"));
  let undiciPackageJson: string | undefined;
  try {
    undiciPackageJson = requireFromNodeTypes.resolve("undici-types/package.json");
  } catch {
    // This @types/node does not depend on undici-types, so there is nothing to pin.
  }
  const undiciVersion = undiciPackageJson && readVersion(undiciPackageJson);
  if (undiciVersion) pins.push(`undici-types@${undiciVersion}`);
  return pins;
}

/**
 * Builds and packs bun-types into a scratch project under `tempDir`, the same
 * way test/integration/bun-types/bun-types.test.ts does, so module resolution
 * matches what a user gets from `bun add -d @types/bun`.
 */
async function createProject(tempDir: string): Promise<{ projectDir: string; versions: Record<string, string> }> {
  const buildDir = join(tempDir, "bun-types");
  const projectDir = join(tempDir, "project");
  await mkdir(projectDir);
  await cp(PACKAGE_ROOT, buildDir, { recursive: true, filter: source => basename(source) !== "node_modules" });

  const version = (process.env.BUN_VERSION ?? Bun.version).replace(/^.*v/, "");
  const tarball = `bun-types-${version}.tgz`;
  await $`cd ${PACKAGE_ROOT} && BUN_VERSION=${version} bun run build ${buildDir}`.quiet();
  await $`cd ${buildDir} && bun pm pack --destination ${projectDir}`.quiet();
  await Bun.write(join(projectDir, "package.json"), JSON.stringify({ name: "inventory", private: true }));
  await $`cd ${projectDir} && bun add bun-types@${tarball} ${pinnedDependencies()} && rm ${tarball}`.quiet();

  const atTypesBun = join(projectDir, "node_modules", "@types", "bun");
  await mkdir(atTypesBun, { recursive: true });
  await Bun.write(join(atTypesBun, "index.d.ts"), '/// <reference types="bun-types" />\n');
  await Bun.write(join(atTypesBun, "package.json"), JSON.stringify({ name: "@types/bun", version }));

  const versions: Record<string, string> = { typescript: ts.version };
  for (const name of ["@types/node", "undici-types"]) {
    const found = readVersion(join(projectDir, "node_modules", name, "package.json"));
    if (found) versions[name] = found;
  }
  return { projectDir, versions };
}

const ENTRY_SOURCE = "export {};\n";

function createProgram(projectDir: string, lib: string[]) {
  const entry = toPosix(join(projectDir, "entry.ts"));
  const options: ts.CompilerOptions = {
    lib,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.Preserve,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    moduleDetection: ts.ModuleDetectionKind.Force,
    jsx: ts.JsxEmit.ReactJSX,
    types: ["bun"],
    strict: true,
    noEmit: true,
    skipLibCheck: true,
  };
  const host = ts.createCompilerHost(options, true);
  const readFile = host.readFile;
  host.readFile = file => (toPosix(file) === entry ? ENTRY_SOURCE : readFile(file));
  const fileExists = host.fileExists;
  host.fileExists = file => toPosix(file) === entry || fileExists(file);
  host.getCurrentDirectory = () => projectDir;
  const program = ts.createProgram({ rootNames: [entry], options, host });
  return { program, entry: program.getSourceFile(entry)! };
}

const byName = (a: { name: string }, b: { name: string }) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

function inventory(program: ts.Program, entry: ts.SourceFile, projectDir: string): string[] {
  const checker = program.getTypeChecker();
  const packageDir = realPathOf(join(projectDir, "node_modules", "bun-types"));
  const tsLibDir = realPathOf(dirname(ts.getDefaultLibFilePath(program.getCompilerOptions())));

  const realPaths = new Map<string, string>();
  function realPath(fileName: string): string {
    let real = realPaths.get(fileName);
    if (real === undefined) {
      try {
        real = realPathOf(fileName);
      } catch {
        // A module path inside `import("...")` type text has no extension.
        real = toPosix(fileName);
      }
      realPaths.set(fileName, real);
    }
    return real;
  }

  function displayFile(fileName: string): string {
    const real = realPath(fileName);
    if (real.startsWith(packageDir + "/")) return "bun-types/" + real.slice(packageDir.length + 1);
    if (real.startsWith(tsLibDir + "/")) return real.slice(tsLibDir.length + 1);
    // `<package>/<file>` for both layouts bun can install: hoisted
    // (node_modules/<package>) and isolated (node_modules/.bun/<package>@<version>/node_modules/<package>).
    const dependency = real.lastIndexOf("/node_modules/");
    if (dependency >= 0) return real.slice(dependency + "/node_modules/".length);
    return toPosix(relative(projectDir, fileName));
  }

  const isPackageFile = (sourceFile: ts.SourceFile) => realPath(sourceFile.fileName).startsWith(packageDir + "/");

  /**
   * True when bun-types declares or augments the symbol. Declarations that merge
   * into a symbol from another package (lib.dom, @types/node) live on the merged
   * symbol, so always test that one.
   */
  const isFromPackage = (sym: ts.Symbol) =>
    (checker.getMergedSymbol(sym).declarations ?? []).some(decl => isPackageFile(decl.getSourceFile()));

  const typeFormat =
    ts.TypeFormatFlags.NoTruncation |
    ts.TypeFormatFlags.UseFullyQualifiedType |
    ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope |
    ts.TypeFormatFlags.WriteArrayAsGenericType;

  // Paths inside `import("...")` type references would leak the temp directory,
  // and TypeScript names a well-known symbol property `__@iterator@123` with an
  // id that changes between programs.
  const pathPattern = new RegExp(
    toPosix(projectDir).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "/node_modules/[^\"']+",
    "g",
  );
  const clean = (text: string) =>
    text
      .replace(pathPattern, match => displayFile(match))
      .replace(/__@(\w+)@\d+/g, "[Symbol.$1]")
      .replace(/\s+/g, " ");

  const rawTypeText = (type: ts.Type) => clean(checker.typeToString(type, undefined, typeFormat));

  /** The type arguments TypeScript prints after the name of an alias, class, or interface instantiation. */
  function referenceTypeArguments(type: ts.Type): readonly ts.Type[] | undefined {
    if (type.aliasSymbol) return type.aliasTypeArguments;
    if (!(type.flags & ts.TypeFlags.Object) || !((type as ts.ObjectType).objectFlags & ts.ObjectFlags.Reference)) {
      return undefined;
    }
    const reference = type as ts.TypeReference;
    // The full list is the outer type parameters, then the declared ones, then
    // the implicit `this` type. Only the declared ones are printed.
    const outer = reference.target.outerTypeParameters?.length ?? 0;
    const declared = reference.target.typeParameters?.length ?? 0;
    return checker.getTypeArguments(reference).slice(outer, declared);
  }

  /**
   * A member of a union or an intersection, in parentheses where TypeScript
   * would put them: function types, conditional types, and (`wrap`) an
   * intersection inside a union or a union inside an intersection.
   */
  function memberText(member: ts.Type, wrap: boolean): string {
    const text = typeText(member);
    // An aliased member prints as its name, `Bun.X` or `Bun.X<T>`.
    if (member.aliasSymbol) return text;
    const isFunction = /^(new )?[(<]/.test(text) && text.includes("=> ");
    const isConditional = !!(member.flags & ts.TypeFlags.Conditional);
    return wrap || isFunction || isConditional ? `(${text})` : text;
  }

  /**
   * TypeScript orders union members by internal type id, which shifts whenever a
   * declaration moves. Sort them so that a refactor with no type change is a
   * no-op in the output. Function-typed members print one signature per overload
   * for the same reason: `signatureToString` is stable, the anonymous object
   * type around it is not.
   */
  function typeText(type: ts.Type, expandAlias?: ts.Symbol): string {
    if (type.isUnion() && (!type.aliasSymbol || type.aliasSymbol === expandAlias)) {
      // A union built from an aliased union plus extra members (`FormDataEntryValue | null`)
      // keeps the alias in `origin`. Print through it so the alias name survives.
      // A `keyof X` origin is not a union: TypeScript prints it as `keyof X`, keep that.
      const origin = (type as ts.Type & { origin?: ts.Type }).origin;
      if (origin && !origin.isUnion()) return rawTypeText(type);
      const parts = origin?.isUnion() ? origin.types : type.types;
      const isBooleanLiteral = (t: ts.Type, name: string) =>
        !!(t.flags & ts.TypeFlags.BooleanLiteral) && (t as ts.Type & { intrinsicName?: string }).intrinsicName === name;
      const hasTrue = parts.some(t => isBooleanLiteral(t, "true"));
      const hasFalse = parts.some(t => isBooleanLiteral(t, "false"));
      const texts = parts
        .filter(t => !(hasTrue && hasFalse && t.flags & ts.TypeFlags.BooleanLiteral))
        .map(t => memberText(t, t.isIntersection()));
      if (hasTrue && hasFalse) texts.push("boolean");
      return texts.sort().join(" | ");
    }
    if (type.isIntersection() && !type.aliasSymbol) {
      // TypeScript keeps intersection members in source order, so only recurse.
      return type.types.map(t => memberText(t, t.isUnion())).join(" & ");
    }
    // `Name<Arg, Arg>`: a class, interface, or alias instantiation. Print the
    // arguments through typeText so unions inside them are sorted too. The
    // positional mapping is only trusted when re-rendering the arguments the way
    // TypeScript does reproduces its own text.
    const typeArguments = referenceTypeArguments(type);
    if (typeArguments && typeArguments.length > 0) {
      const raw = rawTypeText(type);
      const open = raw.indexOf("<");
      const name = open > 0 ? raw.slice(0, open) : "";
      if (/^[\w$.]+$/.test(name)) {
        // TypeScript drops trailing arguments that equal their defaults, so try each prefix.
        const rawArguments = typeArguments.map(rawTypeText);
        for (let count = rawArguments.length; count > 0; count--) {
          if (raw === `${name}<${rawArguments.slice(0, count).join(", ")}>`) {
            return `${name}<${typeArguments
              .slice(0, count)
              .map(t => typeText(t))
              .join(", ")}>`;
          }
        }
      }
    }
    const callSignatures = checker.getSignaturesOfType(type, ts.SignatureKind.Call);
    if (
      callSignatures.length > 0 &&
      !type.aliasSymbol &&
      type.symbol &&
      type.symbol.flags & (ts.SymbolFlags.Method | ts.SymbolFlags.Function | ts.SymbolFlags.TypeLiteral) &&
      checker.getPropertiesOfType(type).length === 0 &&
      checker.getSignaturesOfType(type, ts.SignatureKind.Construct).length === 0
    ) {
      if (callSignatures.length === 1) return signatureText(callSignatures[0]!, ts.SignatureKind.Call, " => ");
      return `{ ${callSignatures.map(sig => signatureText(sig, ts.SignatureKind.Call, ": ")).join("; ")} }`;
    }
    return rawTypeText(type);
  }

  function typeParamsText(params: readonly ts.TypeParameter[] | undefined): string {
    if (!params || params.length === 0) return "";
    return `<${params
      .map(tp => {
        let text = rawTypeText(tp);
        const constraint = tp.getConstraint();
        if (constraint) text += ` extends ${typeText(constraint)}`;
        const fallback = tp.getDefault();
        if (fallback) text += ` = ${typeText(fallback)}`;
        return text;
      })
      .join(", ")}>`;
  }

  function signatureText(sig: ts.Signature, kind: ts.SignatureKind, arrow: string): string {
    const params = sig.parameters.map(param => {
      const decl = param.valueDeclaration as ts.ParameterDeclaration | undefined;
      const rest = decl && decl.dotDotDotToken ? "..." : "";
      const optional = decl && (decl.questionToken || decl.initializer) ? "?" : "";
      return `${rest}${param.name}${optional}: ${typeText(checker.getTypeOfSymbol(param))}`;
    });
    if (sig.thisParameter) {
      params.unshift(`this: ${typeText(checker.getTypeOfSymbol(sig.thisParameter))}`);
    }
    const predicate = checker.getTypePredicateOfSignature(sig);
    const returns = predicate
      ? clean(checker.typePredicateToString(predicate))
      : typeText(checker.getReturnTypeOfSignature(sig));
    const head = `${typeParamsText(sig.typeParameters)}(${params.join(", ")})`;
    return `${kind === ts.SignatureKind.Construct ? "new " : ""}${head}${arrow}${returns}`;
  }

  const lines: string[] = [];
  const seen = new Map<ts.Symbol, string>();

  function modifiers(sym: ts.Symbol): string {
    const out: string[] = [];
    if (sym.flags & ts.SymbolFlags.Optional) out.push("?");
    const decl = sym.valueDeclaration ?? sym.declarations?.[0];
    if (decl && ts.canHaveModifiers(decl)) {
      const mods = ts.getCombinedModifierFlags(decl);
      if (mods & ts.ModifierFlags.Readonly) out.push("readonly");
      if (mods & ts.ModifierFlags.Static) out.push("static");
    }
    return out.length ? ` [${out.join(" ")}]` : "";
  }

  function emitTypeMembers(type: ts.Type, indent: string) {
    for (const sig of checker.getSignaturesOfType(type, ts.SignatureKind.Call)) {
      lines.push(`${indent}call ${signatureText(sig, ts.SignatureKind.Call, ": ")}`);
    }
    for (const sig of checker.getSignaturesOfType(type, ts.SignatureKind.Construct)) {
      lines.push(`${indent}construct ${signatureText(sig, ts.SignatureKind.Construct, ": ")}`);
    }
    for (const info of checker.getIndexInfosOfType(type)) {
      lines.push(
        `${indent}index [${typeText(info.keyType)}]: ${typeText(info.type)}${info.isReadonly ? " [readonly]" : ""}`,
      );
    }
    const props = [...checker.getPropertiesOfType(type)].sort(byName);
    for (const prop of props) {
      lines.push(`${indent}${clean(prop.name)}${modifiers(prop)}: ${typeText(checker.getTypeOfSymbol(prop))}`);
    }
  }

  function declaredIn(sym: ts.Symbol): string {
    const files = new Set((sym.declarations ?? []).map(d => displayFile(d.getSourceFile().fileName)));
    return [...files].sort().join(", ");
  }

  /** Follows an alias (`export import Bun = BunModule`, `export = contents`) to the merged symbol it names. */
  const resolveSymbol = (sym: ts.Symbol) =>
    checker.getMergedSymbol(sym.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(sym) : sym);

  /** The exports of a module or namespace that bun-types declares, augments, or re-exports. */
  const packageExportsOf = (container: ts.Symbol) =>
    checker
      .getExportsOfModule(container)
      .map(member => checker.getMergedSymbol(member))
      .filter(member => member.name !== "prototype" && !member.name.startsWith("export="))
      .filter(isFromPackage)
      .sort(byName);

  function emitSymbol(sym: ts.Symbol, path: string, indent: string) {
    const target = resolveSymbol(sym);
    const earlier = seen.get(target);
    if (earlier !== undefined) {
      lines.push(`${indent}${path} -> ${earlier}`);
      return;
    }
    seen.set(target, path);
    const where = declaredIn(target);
    const inner = indent + "  ";

    if (target.flags & ts.SymbolFlags.Class) {
      const declared = checker.getDeclaredTypeOfSymbol(target) as ts.InterfaceType;
      lines.push(`${indent}class ${path}${typeParamsText(declared.typeParameters)} (${where})`);
      emitTypeMembers(declared, inner);
      lines.push(`${inner}[static]`);
      emitTypeMembers(checker.getTypeOfSymbol(target), inner + "  ");
    } else {
      if (target.flags & ts.SymbolFlags.Interface) {
        const declared = checker.getDeclaredTypeOfSymbol(target) as ts.InterfaceType;
        lines.push(`${indent}interface ${path}${typeParamsText(declared.typeParameters)} (${where})`);
        emitTypeMembers(declared, inner);
      } else if (target.flags & ts.SymbolFlags.TypeAlias) {
        const declared = checker.getDeclaredTypeOfSymbol(target);
        const decl = target.declarations?.find(ts.isTypeAliasDeclaration);
        const params = decl?.typeParameters?.map(
          p => checker.getDeclaredTypeOfSymbol(checker.getSymbolAtLocation(p.name)!) as ts.TypeParameter,
        );
        // A union on the right-hand side goes through typeText for a stable member order.
        const aliasText = declared.isUnion()
          ? typeText(declared, target)
          : clean(checker.typeToString(declared, undefined, typeFormat | ts.TypeFormatFlags.InTypeAlias));
        lines.push(`${indent}type ${path}${typeParamsText(params)} (${where}) = ${aliasText}`);
      } else if (target.flags & ts.SymbolFlags.Enum) {
        lines.push(`${indent}enum ${path} (${where})`);
        for (const member of checker.getExportsOfModule(target)) {
          lines.push(`${inner}${member.name} = ${typeText(checker.getDeclaredTypeOfSymbol(member))}`);
        }
      }
      if (target.flags & (ts.SymbolFlags.Variable | ts.SymbolFlags.Function | ts.SymbolFlags.Property)) {
        const kind = target.flags & ts.SymbolFlags.Function ? "function" : "var";
        const type = checker.getTypeOfSymbol(target);
        const expand =
          type.flags & ts.TypeFlags.Object &&
          type.symbol &&
          !(type.symbol.flags & ts.SymbolFlags.Class) &&
          (type.symbol.flags & ts.SymbolFlags.TypeLiteral || target.flags & ts.SymbolFlags.Function);
        if (expand) {
          lines.push(`${indent}${kind} ${path} (${where})`);
          emitTypeMembers(type, inner);
        } else {
          lines.push(`${indent}${kind} ${path} (${where}): ${typeText(type)}`);
        }
      }
    }

    if (target.flags & (ts.SymbolFlags.Namespace | ts.SymbolFlags.Module) && !(target.flags & ts.SymbolFlags.Enum)) {
      if (!(target.flags & ts.SymbolFlags.Class)) {
        lines.push(`${indent}namespace ${path} (${where})`);
      }
      for (const member of packageExportsOf(target)) {
        if (member.name === "default") continue;
        emitSymbol(member, `${path}.${member.name}`, inner);
      }
    }
  }

  // Modules: the ones bun-types declares (`declare module "bun"`, `declare module
  // "bun:test"`, the `declare module "*.html"` wildcards) and the ones it augments
  // from a module file (`declare module "node:tls"` in overrides.d.ts). An
  // augmentation merges into a copy of the target module's symbol, so
  // getMergedSymbol is what carries the bun-types declarations.
  const modules = checker
    .getAmbientModules()
    .map(mod => checker.getMergedSymbol(mod))
    .filter(isFromPackage)
    .sort(byName);
  for (const mod of modules) {
    lines.push(`# module ${mod.name}`);
    seen.set(mod, `module ${mod.name}`);
    const exportEquals = mod.exports?.get(ts.InternalSymbolName.ExportEquals as ts.__String);
    if (exportEquals) {
      lines.push(`export = ${typeText(checker.getTypeOfSymbol(resolveSymbol(exportEquals)))}`);
    }
    for (const member of packageExportsOf(mod)) emitSymbol(member, member.name, "");
    lines.push("");
  }

  // Globals: every symbol in scope at the entry file that bun-types declares or augments.
  const globals = checker
    .getSymbolsInScope(
      entry,
      ts.SymbolFlags.Value | ts.SymbolFlags.Type | ts.SymbolFlags.Namespace | ts.SymbolFlags.Alias,
    )
    .map(sym => checker.getMergedSymbol(sym))
    .filter(sym => !sym.name.startsWith('"'))
    .filter(sym => !sym.declarations?.some(d => d.getSourceFile() === entry))
    .filter(isFromPackage)
    .sort(byName);

  lines.push("# globals");
  for (const sym of globals) emitSymbol(sym, sym.name, "");

  return lines;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  // The canonical form, so the paths built from it match TypeScript's file names (see realPathOf).
  const tempDir = realpathSync.native(await mkdtemp(join(tmpdir(), "bun-types-inventory-")));
  try {
    const { projectDir, versions } = await createProject(tempDir);
    let failed = false;
    for (const preset of args.presets) {
      const { lib } = PRESETS[preset]!;
      const { program, entry } = createProgram(projectDir, lib);
      const lines = inventory(program, entry, projectDir);
      const header = [
        `# bun-types inventory: preset ${preset}`,
        `# lib: ${lib.join(", ") || "(none)"}`,
        ...Object.entries(versions).map(([name, version]) => `# ${name}: ${version}`),
        "",
      ];
      const text = header.concat(lines).join("\n") + "\n";
      const outFile = join(args.out, `${preset}.txt`);
      if (args.check) {
        const expected = existsSync(outFile) ? readFileSync(outFile, "utf8").replaceAll("\r\n", "\n") : "";
        if (expected === text) {
          console.log(`${preset}: ok`);
        } else {
          failed = true;
          const actualFile = join(tempDir, `${preset}.actual.txt`);
          await Bun.write(actualFile, text);
          console.log(`${preset}: differs from ${outFile}`);
          console.log(await $`git diff --no-index --no-color -- ${outFile} ${actualFile}`.nothrow().text());
        }
      } else {
        await mkdir(args.out, { recursive: true });
        await Bun.write(outFile, text);
        console.log(`${preset}: wrote ${lines.length} lines to ${outFile}`);
      }
    }
    if (failed) {
      console.log("Regenerate with `bun packages/bun-types/scripts/inventory.ts` when the change is intended.");
      process.exitCode = 1;
    }
  } finally {
    if (args.keep) console.log(`kept ${tempDir}`);
    else await rm(tempDir, { recursive: true, force: true });
  }
}

await main();
