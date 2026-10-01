// Writes synthetic cases that reach the parts of the config file matcher and of the roots rule that the corpus does not.
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
const out = (process.argv[2] ?? "/tmp/im-td/synth/cases") + "/compiler";
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
let n = 0;
type Unit = [string, string];
function emit(name: string, header: string[], units: Unit[], links: [string, string][] = []) {
  const lines: string[] = [...header];
  for (const [l, t] of links) lines.push(`// @link: ${t} -> ${l}`);
  for (const [file, text] of units) {
    lines.push(`// @filename: ${file}`);
    lines.push(text);
  }
  writeFileSync(`${out}/${name}.ts`, lines.join("\n") + "\n");
  n++;
}
const cfg = (o: unknown) => JSON.stringify(o, null, 2);
const x = "export const x = 1;";
const tree: Unit[] = [
  ["/p/a.ts", x], ["/p/a.d.ts", x], ["/p/a.js", x], ["/p/a.tsx", x], ["/p/a.jsx", x], ["/p/b.js", x], ["/p/b.d.ts", x], ["/p/c.mts", x], ["/p/c.d.mts", x], ["/p/c.mjs", x],
  ["/p/d.cts", x], ["/p/d.cjs", x], ["/p/e.json", "{}"], ["/p/f.min.js", x], ["/p/g.txt", x], ["/p/.hidden.ts", x], ["/p/.dir/h.ts", x],
  ["/p/node_modules/m/i.ts", x], ["/p/bower_components/j.ts", x], ["/p/jspm_packages/k.ts", x], ["/p/Node_Modules/l.ts", x],
  ["/p/src/m.ts", x], ["/p/src/deep/n.ts", x], ["/p/src/deep/deeper/o.tsx", x], ["/p/src/p.test.ts", x], ["/p/dist/q.ts", x], ["/p/types/r.d.ts", x], ["/p/out.v2/s.ts", x],
  ["/p/src/data.json", "{}"], ["/q/t.ts", x], ["/p/srcx/u.ts", x], ["/p/src/a b/v.ts", x], ["/p/src/é/w.ts", x], ["/p/src/x.ts.map", x], ["/p/tsconfig.base.json", "{}"],
];
const configs: [string, unknown][] = [
  ["empty", {}],
  ["allowJs", { compilerOptions: { allowJs: true } }],
  ["checkJs", { compilerOptions: { checkJs: true } }],
  ["allowJsFalseCheckJs", { compilerOptions: { allowJs: false, checkJs: true } }],
  ["outDir", { compilerOptions: { outDir: "dist" } }],
  ["outDirDot", { compilerOptions: { outDir: "./out.v2", declarationDir: "types" } }],
  ["outDirConfigDir", { compilerOptions: { outDir: "${configDir}/dist" } }],
  ["outDirWithExclude", { compilerOptions: { outDir: "dist" }, exclude: ["src/deep"] }],
  ["excludeEmpty", { compilerOptions: { outDir: "dist" }, exclude: [] }],
  ["excludeGlob", { exclude: ["**/*.test.ts", "src/deep/**/*"] }],
  ["excludeTrailingRecursion", { exclude: ["src/**"] }],
  ["excludeNodeModulesExplicit", { include: ["**/*", "node_modules/m/*"], exclude: [] }],
  ["filesOnly", { files: ["src/m.ts", "./a.ts", "/q/t.ts", "missing.ts"] }],
  ["filesEmpty", { files: [] }],
  ["filesAndInclude", { files: ["a.js"], include: ["src"] }],
  ["filesNotStrings", { files: ["a.ts", 5, null, true, "b.d.ts"] }],
  ["filesConfigDir", { files: ["${configDir}/src/m.ts", "${CONFIGDIR}/a.ts"] }],
  ["includeDir", { include: ["src"] }],
  ["includeDirSlash", { include: ["src/"] }],
  ["includeStar", { include: ["*"] }],
  ["includeStarTs", { include: ["*.ts"] }],
  ["includeQuestion", { include: ["?.ts", "src/?.ts"] }],
  ["includeDeepStar", { include: ["src/**/*"] }],
  ["includeDeepTsx", { include: ["src/**/*.tsx", "src/*.ts"] }],
  ["includeTrailingRecursion", { include: ["src/**", "**"] }],
  ["includeDotDot", { include: ["../q", "src/../srcx"] }],
  ["includeDotDotAfterRecursive", { include: ["**/../q/*"] }],
  ["includeAbsolute", { include: ["/q/*.ts", "/p/src/deep"] }],
  ["includeHidden", { include: [".dir", ".hidden.ts", "*/h.ts"] }],
  ["includePackageFolders", { include: ["node_modules", "bower_components/*", "*/m/*"] }],
  ["includeMinJs", { compilerOptions: { allowJs: true }, include: ["*.js", "*.min.js"] }],
  ["includeMinJsStar", { compilerOptions: { allowJs: true }, include: ["*"] }],
  ["includeJson", { include: ["*.json", "src/*.json", "src"] }],
  ["includeJsonNoResolve", { compilerOptions: { resolveJsonModule: false }, include: ["*.json", "src"] }],
  ["includeJsonNode16", { compilerOptions: { module: "node16" }, include: ["**/*.json"] }],
  ["includeJsonNodeNext", { compilerOptions: { module: "nodenext" }, include: ["**/*.json"] }],
  ["includeJsonNode10", { compilerOptions: { moduleResolution: "node10" }, include: ["src/*.json"] }],
  ["includeOrder", { compilerOptions: { allowJs: true }, include: ["*.js", "*.ts", "*.d.ts"] }],
  ["includeOrder2", { compilerOptions: { allowJs: true }, include: ["a.js", "a.d.ts", "a.ts", "a.tsx"] }],
  ["includeNotStrings", { include: ["src", 1, null] }],
  ["includeString", { include: "src" }],
  ["includeNull", { include: null }],
  ["includeConfigDir", { include: ["${configDir}/src/deep"] }],
  ["includeSpaceUnicode", { include: ["src/a b", "src/é/*"] }],
  ["includeCase", { include: ["SRC", "Src/*.ts"] }],
  ["rootArray", [{ include: ["src"] }]],
  ["nullCompilerOptions", { compilerOptions: null }],
  ["optionsWrongTypes", { compilerOptions: { allowJs: "true", outDir: 5, checkJs: null } }],
  ["optionsWrongCase", { compilerOptions: { AllowJs: true, outdir: "src" } }],
  ["duplicateKeys", '{ "include": ["src"], "include": ["srcx"], "compilerOptions": { "outDir": "src" }, "compilerOptions": { "allowJs": true } }'],
  ["comments", '// c\n{ /* c */ "include": ["src", ], }'],
];
for (const [name, c] of configs) {
  emit("cfg_" + name, ["// @target: es2015"], [["/p/tsconfig.json", typeof c === "string" ? c : cfg(c)], ...tree]);
}
// relative names and another current directory
emit("rel_default", [], [["tsconfig.json", cfg({})], ["a.ts", x], ["sub/b.ts", x], ["node_modules/c/index.d.ts", x], ["/other/d.ts", x]]);
emit("rel_cwd", ["// @currentDirectory: /work/dir"], [["tsconfig.json", cfg({})], ["a.ts", x], ["../up.ts", x], ["/work/dir/sub/b.ts", x]]);
emit("rel_cwd_relative", ["// @currentDirectory: rel/dir"], [["a.ts", x], ["b.ts", x]]);
emit("cfg_in_subdir", [], [["/a/b/tsconfig.json", cfg({ include: ["../c", "."] })], ["/a/b/x.ts", x], ["/a/c/y.ts", x], ["/a/z.ts", x]]);
emit("jsconfig", [], [["/p/jsconfig.json", cfg({})], ["/p/a.js", x], ["/p/b.ts", x]]);
emit("jsconfig_upper", [], [["/p/JSCONFIG.JSON", cfg({})], ["/p/a.js", x], ["/p/b.ts", x]]);
emit("two_configs", [], [["/p/tsconfig.json", cfg({ include: ["a.ts"] })], ["/p/sub/tsconfig.json", cfg({})], ["/p/a.ts", x], ["/p/sub/b.ts", x]]);
emit("config_last", [], [["/p/a.ts", x], ["/p/b.ts", 'import "./a";'], ["/p/tsconfig.json", cfg({ files: ["b.ts"] })]]);
emit("dos_paths", [], [["c:/p/tsconfig.json", cfg({})], ["c:/p/a.ts", x], ["c:/p/src/b.ts", x], ["C:/p/src/c.ts", x]]);
emit("dos_backslash", [], [["c:\\p\\tsconfig.json", cfg({ include: ["src\\*"] })], ["c:\\p\\a.ts", x], ["c:\\p\\src\\b.ts", x]]);
// extends
emit("ext_include", [], [["/base/tsconfig.base.json", cfg({ include: ["src", "/abs/*", "${configDir}/lib"], exclude: ["src/skip"], compilerOptions: { allowJs: true, outDir: "built" } })], ["/p/tsconfig.json", cfg({ extends: "../base/tsconfig.base.json" })], ["/p/a.ts", x], ["/p/src/b.ts", x], ["/p/lib/l.js", x], ["/p/built/o.ts", x], ["/base/src/c.ts", x], ["/base/src/skip/d.ts", x], ["/base/built/e.ts", x], ["/abs/f.ts", x], ["/base/lib/g.ts", x]]);
emit("ext_files", [], [["/base/b.json", cfg({ files: ["one.ts"] })], ["/p/tsconfig.json", cfg({ extends: "../base/b" })], ["/p/one.ts", x], ["/base/one.ts", x]]);
emit("ext_own_wins", [], [["/base/b.json", cfg({ include: ["x"], files: ["one.ts"], compilerOptions: { allowJs: true, outDir: "/p/o" } })], ["/p/tsconfig.json", cfg({ extends: "../base/b.json", include: ["y"], compilerOptions: { allowJs: false, outDir: null } })], ["/p/x/a.ts", x], ["/p/y/b.ts", x], ["/p/y/c.js", x], ["/p/o/d.ts", x], ["/base/one.ts", x]]);
emit("ext_list", [], [["/b1.json", cfg({ include: ["a"], compilerOptions: { allowJs: true } })], ["/b2.json", cfg({ include: ["b"], compilerOptions: { checkJs: true } })], ["/tsconfig.json", cfg({ extends: ["./b1.json", "./b2.json"] })], ["/a/x.ts", x], ["/a/x.js", x], ["/b/y.js", x], ["/c/z.ts", x]]);
emit("ext_chain", [], [["/g.json", cfg({ exclude: ["n"], compilerOptions: { declarationDir: "/p/d" } })], ["/f.json", cfg({ extends: "./g.json" })], ["/p/tsconfig.json", cfg({ extends: "../f.json" })], ["/p/a.ts", x], ["/p/n/b.ts", x], ["/n/c.ts", x], ["/p/d/e.ts", x]]);
emit("ext_cycle", [], [["/p/a.json", cfg({ extends: "./tsconfig.json", include: ["s"] })], ["/p/tsconfig.json", cfg({ extends: "./a.json" })], ["/p/s/a.ts", x], ["/p/b.ts", x]]);
emit("ext_missing", [], [["/p/tsconfig.json", cfg({ extends: "./nope.json", include: ["s"] })], ["/p/s/a.ts", x], ["/p/b.ts", x]]);
emit("ext_empty_string", [], [["/p/tsconfig.json", cfg({ extends: "" })], ["/p/s/a.ts", x]]);
emit("ext_empty_file", [], [["/p/base.json", ""], ["/p/tsconfig.json", cfg({ extends: "./base.json" })], ["/p/s/a.ts", x]]);
emit("ext_not_object", [], [["/p/base.json", "[]"], ["/p/tsconfig.json", cfg({ extends: "./base.json" })], ["/p/s/a.ts", x]]);
// links
emit("link_dir_in", [], [["/p/tsconfig.json", cfg({})], ["/p/a.ts", x], ["/shared/s.ts", x]], [["/p/linked", "/shared"]]);
emit("link_dir_cycle", [], [["/p/tsconfig.json", cfg({})], ["/p/a.ts", x], ["/p/sub/b.ts", x]], [["/p/sub/up", "/p"]]);
emit("link_dir_twice", [], [["/p/tsconfig.json", cfg({})], ["/p/a.ts", x], ["/shared/s.ts", x]], [["/p/l1", "/shared"], ["/p/l2", "/shared"]]);
emit("link_file", [], [["/p/tsconfig.json", cfg({})], ["/p/a.ts", x], ["/shared/s.ts", x]], [["/p/s.ts", "/shared/s.ts"]]);
emit("link_broken", [], [["/p/tsconfig.json", cfg({})], ["/p/a.ts", x]], [["/p/gone", "/nowhere"], ["/p/gone.ts", "/nowhere.ts"]]);
emit("link_over_unit", [], [["/p/tsconfig.json", cfg({})], ["/p/a.ts", x], ["/p/b.ts", "export const b = 1;"], ["/q/c.ts", "export const c = 1;"]], [["/p/b.ts", "/q/c.ts"]]);
emit("link_relative", ["// @currentDirectory: /w"], [["tsconfig.json", cfg({})], ["a.ts", x], ["lib/s.ts", x]], [["linked", "lib"]]);
emit("link_config_through", [], [["/real/tsconfig.json", cfg({})], ["/real/a.ts", x], ["/p/b.ts", x]], [["/p/cfgdir", "/real"]]);
emit("symlink_directive", [], [["/p/tsconfig.json", cfg({})], ["/p/a.ts", "// @symlink: /p/l1.ts, /p/sub/l2.ts\n" + x], ["/p/b.ts", x]]);
// the roots rule without a config
emit("roots_all", [], [["a.ts", x], ["b.ts", x], ["c.json", "{}"], ["d.tsbuildinfo", "{}"], ["e.d.ts", x]]);
emit("roots_require", [], [["a.ts", x], ["b.json", "{}"], ["c.ts", 'const a = require("./a");']]);
emit("roots_require_comment", [], [["a.ts", x], ["c.ts", "// require(\nexport {};"]]);
emit("roots_reference", [], [["a.ts", x], ["c.ts", '/// <reference path="a.ts" />']]);
emit("roots_reference_tab", [], [["a.ts", x], ["c.ts", "reference\tpath"]]);
emit("roots_reference_two_spaces", [], [["a.ts", x], ["c.ts", "reference  path"]]);
emit("roots_reference_nbsp", [], [["a.ts", x], ["c.ts", "reference\u00a0path"]]);
emit("roots_reference_not_last", [], [["a.ts", '/// <reference path="c.ts" />'], ["c.ts", x]]);
emit("roots_noimplicitreferences", ["// @noImplicitReferences: true"], [["a.ts", x], ["c.ts", x]]);
emit("roots_noimplicitreferences_false", ["// @noImplicitReferences: false"], [["a.ts", x], ["c.ts", x]]);
emit("roots_last_is_json", [], [["a.ts", 'require("./b.json")'], ["b.json", "{}"]]);
emit("roots_last_json_require", ["// @noImplicitReferences: true"], [["a.ts", x], ["b.json", "{}"]]);
emit("roots_lib", [], [["a.ts", x], ["b.ts", '/// <reference path="/.lib/react16.d.ts" />\nexport {};']]);
emit("roots_lib_in_other", [], [["a.ts", '/// <reference path="/.lib/react16.d.ts" />'], ["b.ts", 'import "./a"; require("x");']]);
emit("roots_lib_unit", [], [["/.lib/react16.d.ts", "declare const mine: 1;"], ["a.ts", "mine; // /.lib/"]]);
emit("roots_same_name_twice", [], [["a.ts", "export const first = 1;"], ["a.ts", "export const second = 2;"], ["b.ts", x]]);
emit("roots_case_pair", [], [["a.ts", x], ["A.ts", x]]);
emit("roots_case_pair_insensitive", ["// @useCaseSensitiveFileNames: false"], [["a.ts", x], ["A.ts", x]]);
emit("roots_insensitive", ["// @useCaseSensitiveFileNames: false"], [["a.ts", x], ["B.ts", x]]);
emit("roots_dotdot", [], [["../a.ts", x], ["./b/../c.ts", x], ["d//e.ts", x], ["f\\g.ts", x]]);
emit("roots_vary", ["// @strict: true, false", "// @noImplicitReferences: true"], [["a.ts", x], ["b.ts", x]]);
emit("roots_cwd_semicolon", ["// @currentDirectory: /x;"], [["a.ts", x]]);
emit("roots_mixed_roots", [], [["/a.ts", x], ["c:/b.ts", x]]);
emit("roots_libfiles", ["// @libFiles: react.d.ts"], [["a.ts", x]]);
emit("roots_libfiles_empty", ["// @libFiles:"], [["a.ts", x]]);
emit("libfiles_lib_dropped", ["// @libFiles: lib.d.ts,react.d.ts"], [["a.ts", x]]);
emit("libfiles_lib_kept", ["// @libFiles: lib.d.ts,react.d.ts", "// @noLib: true"], [["a.ts", x]]);
emit("libfiles_nolib_false", ["// @libFiles: lib.d.ts", "// @noLib: false"], [["a.ts", x]]);
emit("libfiles_spaces", ["// @libFiles: react.d.ts, lib.d.ts ,,react16.d.ts"], [["a.ts", x]]);
emit("libfiles_dash", ["// @libFiles: -react.d.ts"], [["a.ts", x]]);
emit("libfiles_nolib_config", ["// @libFiles: lib.d.ts"], [["tsconfig.json", cfg({ compilerOptions: { noLib: true } })], ["a.ts", x]]);
emit("libfiles_nolib_config_overridden", ["// @libFiles: lib.d.ts", "// @noLib: false"], [["tsconfig.json", cfg({ compilerOptions: { noLib: true } })], ["a.ts", x]]);
emit("libfiles_nolib_vary", ["// @libFiles: lib.d.ts", "// @noLib: true, false"], [["a.ts", x]]);
emit("libfiles_subdir", ["// @libFiles: react18/react18.d.ts"], [["a.ts", x]]);
emit("casing_vary", ["// @useCaseSensitiveFileNames: true, false"], [["a.ts", x], ["B.ts", x]]);
emit("casing_upper_value", ["// @useCaseSensitiveFileNames: FALSE"], [["a.ts", x]]);
emit("casing_bad_value", ["// @useCaseSensitiveFileNames: no"], [["a.ts", x]]);
emit("package_folder_names", [], [["/p/tsconfig.json", cfg({})], ["/p/jspm_pac\u212aages/k.ts", x], ["/p/NODE_MODULES/n.ts", x], ["/p/node_module\u017f/s.ts", x], ["/p/Bower_Components/b.ts", x], ["/p/node_modules2/m.ts", x], ["/p/\u0130/i.ts", x]]);
emit("package_folder_include", [], [["/p/tsconfig.json", cfg({ include: ["*/*.ts"] })], ["/p/jspm_pac\u212aages/k.ts", x], ["/p/NODE_MODULES/n.ts", x], ["/p/src/s.ts", x], ["/p/.git/g.ts", x]]);
emit("cwd_root", ["// @currentDirectory: /"], [["a.ts", x], ["sub/b.ts", x]]);
emit("cwd_trailing_slash", ["// @currentDirectory: /w/"], [["a.ts", x]]);
emit("cwd_dos", ["// @currentDirectory: c:/w"], [["a.ts", x], ["c:/x/b.ts", x]]);
emit("cwd_dotdot", ["// @currentDirectory: /w/../v"], [["a.ts", x]]);
emit("cwd_backslash", ["// @currentDirectory: \\w\\x"], [["a.ts", x]]);
emit("cwd_twice", ["// @currentDirectory: /one", "// @currentDirectory: /two"], [["a.ts", x]]);
emit("cwd_config_semicolon", ["// @currentDirectory: /x;"], [["tsconfig.json", cfg({})], ["a.ts", x]]);
console.log("cases", n);
