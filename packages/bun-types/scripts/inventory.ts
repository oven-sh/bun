// Dumps every type that bun-types contributes to a program, with the shape the
// TypeScript checker resolves it to, for several `lib` configurations.
//
// Usage:
//   bun scripts/inventory.ts [--out <dir>] [--preset <name>]... [--check] [--keep]
//
// Each preset writes one file, <out>/<preset>.txt, with one line per global, per
// module export, and per member. Interface merging, `UseLibDomIfAvailable`, and
// every other conditional alias are resolved, so the file shows what a user sees,
// not what the .d.ts source says. The files are plain text sorted by name, so
// `git diff` on them is the review surface for a change to packages/bun-types.
//
// With --check the tool writes nothing. It exits 1 and prints a diff when a
// preset's output differs from the file in <out>.
//
// The default output directory is test/integration/bun-types/inventory.
import { $ } from "bun";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
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
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--out") out.out = resolve(argv[++i]!);
    else if (arg === "--preset") out.presets.push(argv[++i]!);
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

function readVersion(packageJson: string): string | undefined {
  return existsSync(packageJson) ? JSON.parse(readFileSync(packageJson, "utf8")).version : undefined;
}

/**
 * Builds and packs bun-types into a scratch project, the same way
 * test/integration/bun-types/bun-types.test.ts does, so module resolution
 * matches what a user gets from `bun add -d @types/bun`. @types/node is pinned
 * to the version in this repository's lockfile, so the output only changes when
 * bun-types or that lockfile changes.
 */
async function createProject(): Promise<{ dir: string; versions: Record<string, string> }> {
  const tempDir = await mkdtemp(join(tmpdir(), "bun-types-inventory-"));
  const buildDir = join(tempDir, "bun-types");
  const projectDir = join(tempDir, "project");
  await mkdir(projectDir);
  await cp(PACKAGE_ROOT, buildDir, { recursive: true, filter: source => basename(source) !== "node_modules" });

  const version = (process.env.BUN_VERSION ?? Bun.version).replace(/^.*v/, "");
  const tarball = `bun-types-${version}.tgz`;
  await $`cd ${PACKAGE_ROOT} && BUN_VERSION=${version} bun run build ${buildDir}`.quiet();
  await $`cd ${buildDir} && bun pm pack --destination ${projectDir}`.quiet();
  await Bun.write(join(projectDir, "package.json"), JSON.stringify({ name: "inventory", private: true }));
  const nodeTypesVersion = readVersion(join(PACKAGE_ROOT, "node_modules/@types/node/package.json"));
  const nodeTypes = nodeTypesVersion ? [`@types/node@${nodeTypesVersion}`] : [];
  await $`cd ${projectDir} && bun add bun-types@${tarball} ${nodeTypes} && rm ${tarball}`.quiet();

  const atTypesBun = join(projectDir, "node_modules/@types/bun");
  await mkdir(atTypesBun, { recursive: true });
  await Bun.write(join(atTypesBun, "index.d.ts"), '/// <reference types="bun-types" />\n');
  await Bun.write(join(atTypesBun, "package.json"), JSON.stringify({ name: "@types/bun", version }));

  const versions: Record<string, string> = { typescript: ts.version };
  for (const name of ["@types/node", "undici-types"]) {
    const found = readVersion(join(projectDir, "node_modules", name, "package.json"));
    if (found) versions[name] = found;
  }
  return { dir: tempDir, versions };
}

function createProgram(projectDir: string, lib: string[]) {
  const entry = join(projectDir, "entry.ts");
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
  host.readFile = file => (file === entry ? "export {};\n" : readFile(file));
  const fileExists = host.fileExists;
  host.fileExists = file => file === entry || fileExists(file);
  host.getCurrentDirectory = () => projectDir;
  return ts.createProgram({ rootNames: [entry], options, host });
}

const byName = (a: { name: string }, b: { name: string }) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

function inventory(program: ts.Program, projectDir: string): string[] {
  const checker = program.getTypeChecker();
  const entry = program.getSourceFile(join(projectDir, "entry.ts"))!;
  const packageDir = realpathSync(join(projectDir, "node_modules/bun-types"));
  const nodeModules = join(projectDir, "node_modules");
  const tsLibDir = dirname(ts.getDefaultLibFilePath(program.getCompilerOptions()));

  function displayFile(fileName: string): string {
    const real = realpathSync(fileName);
    if (real.startsWith(packageDir + "/")) return "bun-types/" + relative(packageDir, real);
    if (real.startsWith(tsLibDir + "/")) return relative(tsLibDir, real);
    if (real.startsWith(nodeModules + "/")) return relative(nodeModules, real);
    const store = real.lastIndexOf("/node_modules/");
    if (store >= 0) return real.slice(store + "/node_modules/".length);
    return relative(projectDir, real);
  }

  const isFromPackage = (sym: ts.Symbol) =>
    (sym.declarations ?? []).some(decl => realpathSync(decl.getSourceFile().fileName).startsWith(packageDir + "/"));

  const typeFormat =
    ts.TypeFormatFlags.NoTruncation |
    ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope |
    ts.TypeFormatFlags.WriteArrayAsGenericType;

  // Paths inside `import("...")` type references would leak the temp directory,
  // and TypeScript names a well-known symbol property `__@iterator@123` with an
  // id that changes between programs.
  const pathPattern = new RegExp(projectDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "/node_modules/[^\"']+", "g");
  const clean = (text: string) =>
    text
      .replace(pathPattern, match => displayFile(match))
      .replace(/__@(\w+)@\d+/g, "[Symbol.$1]")
      .replace(/\s+/g, " ");

  const rawTypeText = (type: ts.Type) => clean(checker.typeToString(type, undefined, typeFormat));

  /**
   * TypeScript orders union members by internal type id, which shifts whenever a
   * declaration moves. Sort them so that a refactor with no type change is a
   * no-op in the output. Function-typed members print one signature per overload
   * for the same reason: `signatureToString` is stable, the anonymous object
   * type around it is not.
   */
  function typeText(type: ts.Type): string {
    if (type.isUnion() && !type.aliasSymbol) {
      // A union built from an aliased union plus extra members (`FormDataEntryValue | null`)
      // keeps the alias in `origin`. Print through it so the alias name survives.
      // A `keyof X` origin is not a union: TypeScript prints it as `keyof X`, keep that.
      const origin = (type as ts.Type & { origin?: ts.Type }).origin;
      if (origin && !origin.isUnion()) return rawTypeText(type);
      const parts = origin?.isUnion() ? origin.types : type.types;
      const hasTrue = parts.some(t => t.flags & ts.TypeFlags.BooleanLiteral && (t as any).intrinsicName === "true");
      const hasFalse = parts.some(t => t.flags & ts.TypeFlags.BooleanLiteral && (t as any).intrinsicName === "false");
      const texts = parts
        .filter(t => !(hasTrue && hasFalse && t.flags & ts.TypeFlags.BooleanLiteral))
        .map(t => typeText(t));
      if (hasTrue && hasFalse) texts.push("boolean");
      // A function type inside a union needs parentheses: `((x: T) => void) | null`.
      return texts
        .map(t => (/^[(<]/.test(t) && t.includes(" => ") ? `(${t})` : t))
        .sort()
        .join(" | ");
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
    const typeParams = sig.typeParameters?.map(tp => {
      let text = rawTypeText(tp);
      const constraint = tp.getConstraint();
      if (constraint) text += ` extends ${typeText(constraint)}`;
      const fallback = tp.getDefault();
      if (fallback) text += ` = ${typeText(fallback)}`;
      return text;
    });
    const predicate = checker.getTypePredicateOfSignature(sig);
    const returns = predicate
      ? clean(checker.typePredicateToString(predicate))
      : typeText(checker.getReturnTypeOfSignature(sig));
    const head = `${typeParams?.length ? `<${typeParams.join(", ")}>` : ""}(${params.join(", ")})`;
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

  function emitSymbol(sym: ts.Symbol, path: string, indent: string) {
    const target = sym.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(sym) : sym;
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
        const aliasText = clean(checker.typeToString(declared, undefined, typeFormat | ts.TypeFormatFlags.InTypeAlias));
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
      const exports = [...checker.getExportsOfModule(target)].sort(byName);
      for (const member of exports) {
        if (member.name === "prototype" || member.name === "default") continue;
        emitSymbol(member, `${path}.${member.name}`, inner);
      }
    }
  }

  // Ambient modules: `declare module "bun"`, `declare module "bun:test"`, the
  // `declare module "*.html"` wildcards, and the augmentations of node modules.
  const modules = checker.getAmbientModules().filter(isFromPackage).sort(byName);
  for (const mod of modules) {
    lines.push(`# module ${mod.name}`);
    seen.set(mod, `module ${mod.name}`);
    const exports = [...checker.getExportsOfModule(mod)].sort(byName);
    for (const member of exports) emitSymbol(member, member.name, "");
    lines.push("");
  }

  // Globals: every symbol in scope at the entry file that bun-types declares or augments.
  const globals = checker
    .getSymbolsInScope(
      entry,
      ts.SymbolFlags.Value | ts.SymbolFlags.Type | ts.SymbolFlags.Namespace | ts.SymbolFlags.Alias,
    )
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
  const project = await createProject();
  const projectDir = join(project.dir, "project");
  try {
    let failed = false;
    for (const preset of args.presets) {
      const { lib } = PRESETS[preset]!;
      const lines = inventory(createProgram(projectDir, lib), projectDir);
      const header = [
        `# bun-types inventory: preset ${preset}`,
        `# lib: ${lib.join(", ") || "(none)"}`,
        ...Object.entries(project.versions).map(([name, version]) => `# ${name}: ${version}`),
        "",
      ];
      const text = header.concat(lines).join("\n") + "\n";
      const outFile = join(args.out, `${preset}.txt`);
      if (args.check) {
        const expected = existsSync(outFile) ? readFileSync(outFile, "utf8") : "";
        if (expected === text) {
          console.log(`${preset}: ok`);
        } else {
          failed = true;
          const actualFile = join(project.dir, `${preset}.actual.txt`);
          await Bun.write(actualFile, text);
          console.log(`${preset}: differs from ${outFile}`);
          console.log(await $`diff -u ${outFile} ${actualFile}`.nothrow().text());
        }
      } else {
        await mkdir(args.out, { recursive: true });
        await Bun.write(outFile, text);
        console.log(`${preset}: wrote ${lines.length} lines to ${outFile}`);
      }
    }
    if (failed) process.exitCode = 1;
  } finally {
    if (args.keep) console.log(`kept ${project.dir}`);
    else await rm(project.dir, { recursive: true, force: true });
  }
}

await main();
