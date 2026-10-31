// The cases of ../minifying-first-saves-no-code.ts that are larger as written today: by which form of the bundler's, and from how much as written to how much.
// `AOT_REDS=<file> bun test --todo ..` says what they are now.
export const knownToday: Record<string, string> = {
  "--define: typeof of a name [js]":
    'written: "server\\n\\nexit 0", bun run "server\\nerror: BuildMessage: define key \\"typeof window\\" mus; each file: the bundler: error: define key "typeof window" must be a valid identifier; bundled: the bundler: error: define key "typeof window" must be a valid identifier',
  "built-in constructors and calls on constants: an element of a constant list [js, two files]":
    "bundled: code bytes 202 -> 106, operations 10 -> 6, run-time operations 239 -> 238",
  "built-in constructors and calls on constants: an element of a constant list [ts, two files]":
    "bundled: code bytes 202 -> 106, operations 10 -> 6, run-time operations 239 -> 238",
  "built-in constructors and calls on constants: methods of a constant text [js]":
    "each file: code bytes 489 -> 392, operations 16 -> 15; bundled: code bytes 489 -> 392, operations 16 -> 15",
  "built-in constructors and calls on constants: methods of a constant text [ts]":
    "each file: code bytes 489 -> 392, operations 16 -> 15; bundled: code bytes 489 -> 392, operations 16 -> 15",
  "bundler_merged_enum: ts/EnumCrossModuleInliningMergedDeclarations":
    "written: the build: it may load any file of the executable, so nothing beside it is compiled as it ",
  "bundler_minify: minify+whitespace/Infinity":
    "each file: code bytes 377 -> 321, operations 34 -> 31; bundled: code bytes 377 -> 321, operations 34 -> 31",
  "bundler_minify: minify/AdditionalGlobalConstructorOptimization":
    "each file: operations 253 -> 251; bundled: operations 253 -> 251",
  "bundler_minify: minify/BunRequireStatement":
    "written: the build: it may load any file of the executable, so nothing beside it is compiled as it ",
  "bundler_minify: minify/IdentifiersDollarStillUsableWhenReferenced": "bundled: code bytes 2739 -> 2684",
  "bundler_minify: minify/ImportMetaHotTreeShaking":
    'each file: the build: 1 | import"./other.ts"; |     ^ | error: TS100150: Could not resolve: "./other.ts"; bundled: code bytes 2970 -> 233, operations 169 -> 19',
  "bundler_minify: minify/Infinity":
    "each file: code bytes 386 -> 321, operations 34 -> 31; bundled: code bytes 386 -> 321, operations 34 -> 31",
  "bundler_minify: minify/NumericPropertyKeysPrintedAsComputed":
    "bundled: code bytes 614 -> 493, operations 36 -> 26, run-time operations 256 -> 249",
  "bundler_minify: minify/RequireBunAfterKeyword":
    "written: the build: it may load any file of the executable, so nothing beside it is compiled as it ",
  "bundler_minify: minify/RequireEsmWithoutInitAfterKeyword":
    "each file: the build: it may load any file of the executable, so nothing beside it is compiled as it ; bundled: code bytes 176809 -> 176292, run-time operations 323 -> 319",
  "bundler_minify: minify/RequireEsmWithoutInitAfterKeywordAllMinify":
    "each file: the build: it may load any file of the executable, so nothing beside it is compiled as it ; bundled: code bytes 176809 -> 176292, run-time operations 323 -> 319",
  "bundler_minify: minify/RequireMainToImportMetaMain":
    "each file: code bytes 315 -> 235, operations 27 -> 23; bundled: code bytes 315 -> 212, operations 27 -> 21",
  "bundler_minify: minify/SingleUseSubstitutionIntoEachChild":
    "written: the build: it may load any file of the executable, so nothing beside it is compiled as it ",
  "bundler_minify: minify/StringAdditionFolding":
    "each file: code bytes 659 -> 625, operations 22 -> 20; bundled: code bytes 659 -> 625, operations 22 -> 20",
  "bundler_minify: minify/TypeOfRequire":
    "each file: code bytes 190 -> 110, operations 11 -> 7; bundled: code bytes 190 -> 110, operations 11 -> 7",
  "bundler_minify: minify/UnusedInCommaExpression": "each file: code bytes 390 -> 362; bundled: code bytes 390 -> 362",
  "bundler_minify: minify/WithStatementPinnedNameNotReusedByEnclosingScope":
    "bundled: the build: 6 |   with (obj) |       ^ | error: TS1101: 'with' statements are not allowed i",
  "bundler_minify: minify/WithStatementPinnedNameNotReusedByEnclosingScopeNoBundle":
    "bundled: the build: 6 |   with (obj) |       ^ | error: TS1101: 'with' statements are not allowed i",
  "bundler_minify: minify/WithStatementPinnedNameNotReusedWithoutMinify":
    "bundled: the build: 13 |     with (obj) |          ^ | error: TS1101: 'with' statements are not all",
  "bundler_minify_symbol_for: minify/SymbolForEdgeCases":
    "each file: code bytes 232 -> 192, operations 15 -> 12; bundled: code bytes 232 -> 192, operations 15 -> 12",
  "bundler_minify_symbol_for: minify/SymbolForProduction":
    "each file: code bytes 158 -> 141, operations 10 -> 9; bundled: code bytes 158 -> 141, operations 10 -> 9",
  "bundler_minify_symbol_for: minify/SymbolForRuntimeOverride":
    "written: the build: 5 | Symbol.for = function(key) { |     ^ | error: TS100014: this assignment alw",
  "bundler_minify_symbol_for: minify/SymbolForTreeShaking": "bundled: code bytes 166 -> 131, operations 12 -> 8",
  "bundler_string: string/StringAddition2":
    "each file: run-time operations 241 -> 240; bundled: run-time operations 241 -> 240",
  "bundler_string: string/StringAddition3":
    "each file: run-time operations 241 -> 240; bundled: run-time operations 241 -> 240",
  "bundler_string: string/TernaryWithEscapeVariable":
    "each file: code bytes 173 -> 154, operations 13 -> 12; bundled: code bytes 173 -> 154, operations 13 -> 12",
  "classes: a class used for its static method alone [js, two files]":
    "bundled: code bytes 204 -> 172, operations 11 -> 8",
  "classes: a class used for its static method alone [ts, two files]":
    "bundled: code bytes 204 -> 172, operations 11 -> 8",
  "classes: a static constant field [js, two files]": "bundled: operations 10 -> 8",
  "classes: a static constant field [ts, two files]": "bundled: operations 10 -> 8",
  "classes: a static readonly field [js, two files]": "bundled: operations 8 -> 6",
  "classes: a static readonly field [ts, two files]": "bundled: operations 8 -> 6",
  "constants are put where their names stand: a bigint [js, two files]":
    "bundled: code bytes 185 -> 143, operations 10 -> 7",
  "constants are put where their names stand: a bigint [ts, two files]":
    "bundled: code bytes 185 -> 143, operations 10 -> 7",
  "constants are put where their names stand: a constant as a case label [js]":
    "each file: operations 13 -> 11; bundled: operations 13 -> 11",
  "constants are put where their names stand: a constant as a case label [ts]":
    "each file: operations 13 -> 11; bundled: operations 13 -> 11",
  "constants are put where their names stand: inside an arrow in a loop [ts, two files]":
    "each file: code bytes 2389 -> 2297, operations 86 -> 74; bundled: code bytes 2389 -> 2296, operations 86 -> 74",
  "constants are put where their names stand: inside an arrow in a loop [ts]":
    "each file: code bytes 2388 -> 2296, operations 86 -> 74; bundled: code bytes 2388 -> 2296, operations 86 -> 74",
  "enums: a declared const enum [ts]":
    'written: "error: ReferenceError: Outside is not defined\\n      at /$bunfs/root/c000/entry.ts:2:13\\n; each file: "error: ReferenceError: Outside is not defined\\n      at /$bunfs/root/c000/entry.js:1:13\\n; bundled: "error: ReferenceError: Outside is not defined\\n      at /$bunfs/root/c000/entry.js:3:20\\n',
  "enums: a member as a case label [ts, two files]": "bundled: code bytes 472 -> 416 on arm64",
  "enums: a member as a case label [ts]": "bundled: code bytes 472 -> 416 on arm64",
  "enums: an enum handed out whole [ts, two files]": "bundled: operations 15 -> 13",
  "enums: members are computed [ts]":
    "each file: code bytes 447 -> 375, run-time operations 251 -> 244; bundled: code bytes 447 -> 149, operations 24 -> 7, run-time operations 251 -> 238",
  "enums: the name of a member [ts, two files]": "bundled: code bytes 268 -> 240, operations 16 -> 14",
  "esbuild/dce: dce/ConstValueInliningBundle #5":
    "bundled: code bytes 169 -> 100, operations 9 -> 4; another program: the files throw for a read in the dead zone, the bundle prints 1 1",
  "esbuild/dce: dce/ConstValueInliningBundle #7": "each file: code bytes 153 -> 102, operations 8 -> 5",
  "esbuild/dce: dce/ConstValueInliningBundle #8":
    "bundled: operations 10 -> 7; another program: the files throw for a read in the dead zone, the bundle prints undefined",
  "esbuild/dce: dce/ConstValueInliningBundle #9": "each file: code bytes 153 -> 102, operations 8 -> 5",
  "esbuild/dce: dce/ConstValueInliningDirectEval #6": "each file: operations 9287 -> 9286",
  "esbuild/dce: dce/ConstValueInliningNoBundle #11":
    "bundled: code bytes 141 -> 118, operations 7 -> 6; another program: the files throw for a read in the dead zone, the bundle prints undefined",
  "esbuild/dce: dce/CrossModuleConstantFolding": "bundled: code bytes 1601 -> 1069, operations 66 -> 34",
  "esbuild/dce: dce/DCEOfDestructuringOfUnwrappedRequire":
    "each file: the build: it may load any file of the executable, so nothing beside it is compiled as it ",
  "esbuild/dce: dce/DCETypeOfCompareStringGuardCondition": "bundled: code bytes 836 -> 640, operations 102 -> 70",
  "esbuild/dce: dce/DCEVarExports #2": "bundled: code bytes 295 -> 251",
  "esbuild/dce: dce/DCEVarExports #3":
    "written: the build: it may load any file of the executable, so nothing beside it is compiled as it ",
  "esbuild/dce: dce/DestructuringOfForOfReboundUnwrappedRequire":
    "each file: the build: it may load any file of the executable, so nothing beside it is compiled as it ",
  "esbuild/dce: dce/DestructuringOfImportNamespaceDirectEval": "bundled: code bytes 193669 -> 190533",
  "esbuild/dce: dce/DestructuringOfReboundUnwrappedRequire":
    "each file: the build: it may load any file of the executable, so nothing beside it is compiled as it ",
  "esbuild/dce: dce/NestedFunctionInliningWithSpread #2": "bundled: code bytes 4348 -> 4320 on arm64",
  "esbuild/dce: dce/PackageJsonSideEffectsArrayGlob":
    'bundled: "this should be kept\\n\\nexit 0", bun run "this should be kept\\nTEST FAILED\\n\\nexit 0"; bundled: code bytes 144 -> 105, operations 8 -> 5, run-time operations 240 -> 239',
  "esbuild/dce: dce/PackageJsonSideEffectsArrayKeepMainImplicitModule":
    'bundled: "unused import\\n\\nexit 0", bun run "TEST FAILED\\nunused import\\n\\nexit 0"; bundled: code bytes 141 -> 105, operations 8 -> 5, run-time operations 240 -> 239',
  "esbuild/dce: dce/PackageJsonSideEffectsArrayKeepModuleImplicitModule":
    'written: "this should be kept\\nunused import\\n\\nexit 0", bun run "TEST FAILED\\nunused import\\n\\nexi; each file: "this should be kept\\nunused import\\n\\nexit 0", bun run "TEST FAILED\\nunused import\\n\\nexi; bundled: "this should be kept\\nunused import\\n\\nexit 0", bun run "TEST FAILED\\nunused import\\n\\nexi',
  "esbuild/dce: dce/PackageJsonSideEffectsArrayKeepModuleUseMain":
    'written: "hello\\nunused import\\n\\nexit 0", bun run "TEST FAILED\\nunused import\\n\\nexit 0"; each file: "hello\\nunused import\\n\\nexit 0", bun run "TEST FAILED\\nunused import\\n\\nexit 0"; bundled: "hello\\nunused import\\n\\nexit 0", bun run "TEST FAILED\\nunused import\\n\\nexit 0"',
  "esbuild/dce: dce/PackageJsonSideEffectsArrayKeepModuleUseModule":
    'written: "this should be kept\\nunused import\\n\\nexit 0", bun run "TEST FAILED\\nunused import\\n\\nexi; each file: "this should be kept\\nunused import\\n\\nexit 0", bun run "TEST FAILED\\nunused import\\n\\nexi; bundled: "this should be kept\\nunused import\\n\\nexit 0", bun run "TEST FAILED\\nunused import\\n\\nexi',
  "esbuild/dce: dce/PackageJsonSideEffectsArrayRemove":
    'bundled: "unused import\\n\\nexit 0", bun run "hello\\nunused import\\n\\nexit 0"; bundled: code bytes 144 -> 105, operations 8 -> 5, run-time operations 240 -> 239',
  "esbuild/dce: dce/PackageJsonSideEffectsFalseIntermediateFilesUnused":
    "bundled: code bytes 99 -> 12, operations 4 -> 0",
  "esbuild/dce: dce/PackageJsonSideEffectsFalseKeepBareImportAndRequireCommonJS":
    "each file: the build: it may load any file of the executable, so nothing beside it is compiled as it ",
  "esbuild/dce: dce/PackageJsonSideEffectsFalseKeepBareImportAndRequireES6":
    "each file: the build: it may load any file of the executable, so nothing beside it is compiled as it ",
  "esbuild/dce: dce/PackageJsonSideEffectsFalseKeepNamedImportCommonJS":
    "bundled: code bytes 229 -> 144, operations 12 -> 7, run-time operations 240 -> 239",
  "esbuild/dce: dce/PackageJsonSideEffectsFalseKeepStarImportCommonJS":
    'bundled: "hello\\n{\\"foo\\":123}\\n\\nexit 0", bun run "hello\\n{\\"default\\":{\\"foo\\":123},\\"foo\\":123}\\',
  "esbuild/dce: dce/PackageJsonSideEffectsFalseNoWarningInNodeModulesESBuildIssue999":
    'bundled: "unused import\\nused import\\n\\nexit 0", bun run "FAILED\\nunused import\\nused import\\n\\nexi; bundled: code bytes 180 -> 147, operations 11 -> 7, run-time operations 241 -> 240',
  "esbuild/dce: dce/PackageJsonSideEffectsFalseRemoveBareImportCommonJS":
    'bundled: "unused import\\n\\nexit 0", bun run "TEST FAILED\\nunused import\\n\\nexit 0"; bundled: code bytes 229 -> 105, operations 12 -> 5, run-time operations 241 -> 239',
  "esbuild/dce: dce/PackageJsonSideEffectsFalseRemoveBareImportES6":
    'bundled: "unused import\\n\\nexit 0", bun run "TEST FAILED\\nunused import\\n\\nexit 0"; bundled: code bytes 141 -> 105, operations 8 -> 5, run-time operations 240 -> 239',
  "esbuild/dce: dce/PackageJsonSideEffectsFalseRemoveNamedImportCommonJS":
    'bundled: "unused import\\n\\nexit 0", bun run "TEST FAILED\\nunused import\\n\\nexit 0"; bundled: code bytes 229 -> 105, operations 12 -> 5, run-time operations 241 -> 239',
  "esbuild/dce: dce/PackageJsonSideEffectsFalseRemoveNamedImportES6":
    'bundled: "unused import\\n\\nexit 0", bun run "TEST FAILED\\nunused import\\n\\nexit 0"; bundled: code bytes 141 -> 105, operations 8 -> 5, run-time operations 240 -> 239',
  "esbuild/dce: dce/PackageJsonSideEffectsFalseRemoveStarImportCommonJS":
    'bundled: "unused import\\n\\nexit 0", bun run "TEST FAILED\\nunused import\\n\\nexit 0"; bundled: code bytes 229 -> 105, operations 12 -> 5, run-time operations 241 -> 239',
  "esbuild/dce: dce/PackageJsonSideEffectsFalseRemoveStarImportES6":
    'bundled: "unused import\\n\\nexit 0", bun run "TEST FAILED\\nunused import\\n\\nexit 0"; bundled: code bytes 141 -> 105, operations 8 -> 5, run-time operations 240 -> 239',
  "esbuild/dce: dce/PackageJsonSideEffectsGlobBasicPattern":
    'bundled: "side effect preserved\\nused\\n\\nexit 0", bun run "should be tree-shaken\\nside effect prese; bundled: operations 11 -> 7, run-time operations 241 -> 240',
  "esbuild/dce: dce/PackageJsonSideEffectsGlobBraceExpansion":
    'bundled: "component effect\\nutility effect\\ndone\\n\\nexit 0", bun run "component effect\\nutility eff; bundled: code bytes 219 -> 170, operations 14 -> 9, run-time operations 241 -> 240',
  "esbuild/dce: dce/PackageJsonSideEffectsGlobDeepPattern":
    'bundled: "deep side effect - should be preserved\\nnested side effect - should be preserved\\ndone\\n\\; bundled: code bytes 222 -> 173, operations 14 -> 9, run-time operations 241 -> 240',
  "esbuild/dce: dce/PackageJsonSideEffectsGlobExtensionPattern":
    'bundled: "main effect - should be preserved\\ndone\\n\\nexit 0", bun run "util side effect - should be; bundled: code bytes 222 -> 147, operations 14 -> 7, run-time operations 241 -> 239',
  "esbuild/dce: dce/PackageJsonSideEffectsGlobMixedPatterns":
    'bundled: "specific side effect\\nglob1 side effect\\nglob2 side effect\\nused\\n\\nexit 0", bun run "spe; bundled: operations 17 -> 11, run-time operations 243 -> 242',
  "esbuild/dce: dce/PackageJsonSideEffectsGlobQuestionMark":
    'bundled: "file1 effect\\nfile2 effect\\ndone\\n\\nexit 0", bun run "file1 effect\\nfile2 effect\\nfileAB ; bundled: code bytes 261 -> 173, operations 17 -> 9, run-time operations 242 -> 240',
  "esbuild/dce: dce/PackageJsonSideEffectsKeepExportDefaultExpr": "bundled: code bytes 151 -> 124, operations 11 -> 8",
  "esbuild/dce: dce/PackageJsonSideEffectsTrueKeepCommonJS":
    "bundled: code bytes 232 -> 147, operations 12 -> 7, run-time operations 241 -> 240",
  "esbuild/dce: dce/PureCallsWithSpread":
    "each file: the build: 1 | ...args; |     ^ | error: TS1128: Declaration or statement expected.; |     ^; bundled: the build: 3 | ...args; |     ^ | error: TS1128: Declaration or statement expected.; |     ^",
  "esbuild/dce: dce/RemoveUnusedImportsEval":
    "written: the build: 1 | import keep_a from 'a' |     ^ | error: TS100151: Could not resolve: \"a\". M",
  "esbuild/dce: dce/TextLoaderRemoveUnused": "bundled: code bytes 130 -> 105, operations 7 -> 5",
  "esbuild/dce: dce/TreeShakingClassEnumKey": "bundled: operations 15 -> 13",
  "esbuild/dce: dce/TreeShakingInESMWrapper":
    "each file: the build: it may load any file of the executable, so nothing beside it is compiled as it ",
  "esbuild/dce: dce/TreeShakingUnaryOperators":
    "written: the build: 6 |       delete keep; |                  ^ | error: TS1102: 'delete' cannot be called on an identifier",
  "esbuild/dce: dce/UnreferencedObjectLiteral":
    "each file: code bytes 225 -> 147, operations 14 -> 7, run-time operations 246 -> 240; bundled: code bytes 225 -> 147, operations 14 -> 7, run-time operations 246 -> 240",
  "esbuild/default: default/ArgumentsSpecialCaseNoBundle":
    "written: the build: it may load any file of the executable, so nothing beside it is compiled as it ",
  "esbuild/default: default/AutoExternalBun":
    'written: the build: 12 |       import "node:what-is-this"; |            ^ | error: TS100152: No such built-in module: node:what-is-this |  ; |            ^',
  "esbuild/default: default/AutoExternalNode":
    'written: the build: 10 |       import "node:what-is-this"; |            ^ | error: TS100152: No such built-in module: node:what-is-this |  ',
  "esbuild/default: default/AwaitImportInsideTry":
    "written: the build: it may load any file of the executable, so nothing beside it is compiled as it ",
  "esbuild/default: default/BundlerUsesModuleFieldForEsm":
    'written: "hello index.esm.js\\n\\nexit 0", bun run "hello index.cjs.js\\n\\nexit 0"; each file: "hello index.esm.js\\n\\nexit 0", bun run "hello index.cjs.js\\n\\nexit 0"; bundled: "hello index.esm.js\\n\\nexit 0", bun run "hello index.cjs.js\\n\\nexit 0"',
  "esbuild/default: default/CircularTLADependency2":
    'written: "error: ReferenceError: Cannot access \'c\' before initialization.\\n      at /$bunfs/root/c0; each file: "error: error: Cannot find module \'./b.ts\' from \'/$bunfs/root/c000/entry.js\'\\n\\nexit 1", b; each file: code bytes 14799 -> 14257, operations 873 -> 850; bundled: "c\\ng\\ne\\nf\\nd\\nc\\n\\nexit 0", bun run "error: 1 | // @ts-nocheck\\n2 | import { c } from \\"',
  "esbuild/default: default/DefineImportMeta":
    'written: "the process ended: 1 TypeError: Invalid URL |  input: \\"./c000/start-the-case.mjs\\", |   ; | 4 |  | 5 | const mark = process.env.AOT_MARK; | 6 | for (const program of JSON.parse(readFileSync(process.env.AOT_TASKS, \\"utf; each file: "the process ended: 1 TypeError: Invalid URL |  input: \\"./c000/start-the-case.mjs\\", |   ; | 4 |  | 5 | const mark = process.env.AOT_MARK; | 6 | for (const program of JSON.parse(readFileSync(process.env.AOT_TASKS, \\"utf; each file: code bytes 229 -> 169, operations 11 -> 9; bundled: "the process ended: 1 TypeError: Invalid URL |  input: \\"./c000/start-the-case.mjs\\", |   ; | 4 |  | 5 | const mark = process.env.AOT_MARK; | 6 | for (const program of JSON.parse(readFileSync(process.env.AOT_TASKS, \\"utf; bundled: code bytes 229 -> 169, operations 11 -> 9',
  "esbuild/default: default/DefineOptionalChain":
    "each file: code bytes 173362 -> 173337, operations 8241 -> 8239; bundled: code bytes 173362 -> 173337, operations 8241 -> 8239",
  "esbuild/default: default/DefineOptionalChainLowered":
    "each file: code bytes 173547 -> 173522, operations 8253 -> 8251; bundled: code bytes 173547 -> 173522, operations 8253 -> 8251",
  "esbuild/default: default/DirectEvalTainting2NoBundle":
    "written: the build: it may load any file of the executable, so nothing beside it is compiled as it ",
  "esbuild/default: default/DirectEvalTaintingNoBundle":
    "written: the build: it may load any file of the executable, so nothing beside it is compiled as it ",
  "esbuild/default: default/DynamicImportWithExpressionCJS":
    "written: the build: it may load any file of the executable, so nothing beside it is compiled as it ",
  "esbuild/default: default/ExportFSNodeInCommonJSModule":
    "written: the build: 1 | import * as fs from 'fs' |     ^ | error: TS100106: Cannot use import state",
  "esbuild/default: default/ExportFormsWithMinifyIdentifiersAndNoBundle":
    "written: the build: 10 | export * from './f' |      ^ | error: TS100150: Could not resolve: \"./f\" |",
  "esbuild/default: default/ExportsAndModuleFormatCommonJS":
    "written: the build: 1 | import * as foo from './foo/test' |     ^ | error: TS100106: Cannot use imp",
  "esbuild/default: default/ExternalWildcardDoesNotMatchEntryPoint":
    'written: the build: 1 | import "foo" |     ^ | error: TS100151: Could not resolve: "foo". Maybe you',
  "esbuild/default: default/ImportFormsWithMinifyIdentifiersAndNoBundle":
    "written: the build: 9 |         await import('./c'), |                          ^ | warn: TS100150:",
  "esbuild/default: default/ImportFormsWithNoBundle":
    "written: the build: 9 |         await import('./c'), |                          ^ | warn: TS100150:",
  "esbuild/default: default/ImportMissingCommonJS":
    "written: \"error: SyntaxError: Export named 'y' not found in module '/$bunfs/root/c000/foo.js'.\\n   ; each file: \"error: SyntaxError: Export named 'y' not found in module '/$bunfs/root/c000/foo.js'.\\n   ; bundled: \"123 123 undefined\\n\\nexit 0\", bun run \"error: SyntaxError: Export named 'y' not found in ; bundled: code bytes 354 -> 110, operations 22 -> 5, run-time operations 241 -> 238",
  "esbuild/default: default/ImportMissingNeitherES6NorCommonJS":
    "written: the build: 1 | import fn, {x as a, y as b} from './foo' |            ^ | error: TS100200: ",
  "esbuild/default: default/ImportMissingNeitherES6NorCommonJS #2": "bundled: operations 8 -> 6",
  "esbuild/default: default/ImportThenCatch":
    "written: the build: it may load any file of the executable, so nothing beside it is compiled as it ",
  "esbuild/default: default/ImportWithHashInPath": "bundled: code bytes 165 -> 115, operations 10 -> 6",
  "esbuild/default: default/ImportWithHashParameter":
    "written: the build: 2 | import foo from './file.txt#foo' |     ^ | error: TS100150: Could not resol",
  "esbuild/default: default/ImportWithQueryParameter":
    "written: the build: 2 | import foo from './file.txt?foo' |     ^ | error: TS100159: bun compile doe",
  "esbuild/default: default/MinifiedDynamicImportWithExpressionCJS":
    "written: the build: it may load any file of the executable, so nothing beside it is compiled as it ",
  "esbuild/default: default/MinifiedExportsAndModuleFormatCommonJS":
    "written: the build: 1 | import * as foo from './foo/test' |     ^ | error: TS100106: Cannot use imp",
  "esbuild/default: default/MinifyArguments":
    "written: the build: 2 |   let arguments |           ^ | error: TS1215: Invalid use of 'arguments'. ",
  "esbuild/default: default/ReExportDefaultNoBundle":
    "written: the build: 1 | export {default as foo} from './foo' |     ^ | error: TS100150: Could not r",
  "esbuild/default: default/RequireAndDynamicImportInvalidTemplate":
    "written: the build: it may load any file of the executable, so nothing beside it is compiled as it ",
  "esbuild/default: default/RequireBadArgumentCount":
    "written: the build: it may load any file of the executable, so nothing beside it is compiled as it ",
  "esbuild/default: default/RequirePropertyAccessCommonJS":
    "written: the build: it may load any file of the executable, so nothing beside it is compiled as it ",
  "esbuild/default: default/RequireTxt":
    'written: "This is a` test.\\n\\n\\nexit 0", bun run "Module {\\n  default: \\"This is a` test.\\\\n\\",\\n}\\; each file: "This is a` test.\\n\\n\\nexit 0", bun run "Module {\\n  default: \\"This is a` test.\\\\n\\",\\n}\\; bundled: "This is a` test.\\n\\n\\nexit 0", bun run "Module {\\n  default: \\"This is a` test.\\\\n\\",\\n}\\',
  "esbuild/default: default/RequireWithCallInsideTry": "bundled: code bytes 585 -> 381, operations 25 -> 23",
  "esbuild/default: default/RuntimeUsesMainFieldForEsm":
    'written: "hello index.esm.js\\n\\nexit 0", bun run "hello index.cjs.js\\n\\nexit 0"; each file: "hello index.esm.js\\n\\nexit 0", bun run "hello index.cjs.js\\n\\nexit 0"; bundled: "hello index.esm.js\\n\\nexit 0", bun run "hello index.cjs.js\\n\\nexit 0"',
  "esbuild/default: default/ThisOutsideFunctionNotRenamed":
    "written: the build: it may load any file of the executable, so nothing beside it is compiled as it ",
  "esbuild/default: default/ThisOutsideFunctionRenamedToExports":
    "each file: operations 8271 -> 8270; bundled: operations 8271 -> 8265",
  "esbuild/default: default/ThisUndefinedWarningESM":
    'written: "[ undefined, undefined ] [ undefined, undefined ]\\n\\nexit 0", bun run "[ null, null ] [ n; bundled: code bytes 874 -> 807, operations 35 -> 29',
  "esbuild/default: default/ThisWithES6Syntax":
    'written: "cjs.js: {}\\nes6-import-assign.ts: {}\\nes6-import-dynamic.js: {}\\nes6-expr-import-dynamic.; each file: the build: it may load any file of the executable, so nothing beside it is compiled as it ; bundled: "cjs.js: {}\\nes6-import-stmt.js: null\\nes6-import-assign.ts: {}\\nes6-import-dynamic.js: {}',
  "esbuild/default: default/ToESMWrapperOmission":
    'written: the build: 29 |       x = import("k_WRAP") |                       ^ | warn: TS100151: Cou',
  "esbuild/default: default/TopLevelAwaitAllowedImportWithoutSplitting":
    'bundled: "0\\n1\\n\\nexit 0", bun run "1\\n0\\n\\nexit 0"',
  "esbuild/default: default/TopLevelAwaitWithNestedRequire":
    "each file: the build: it may load any file of the executable, so nothing beside it is compiled as it ",
  "esbuild/default: default/TopLevelAwaitWithStaticImport": "bundled: code bytes 14457 -> 14428, operations 861 -> 859",
  "esbuild/default: default/UseStrictDirectiveMinifyNoBundle":
    "each file: code bytes 178 -> 99, operations 10 -> 6; bundled: code bytes 178 -> 99, operations 10 -> 6",
  "esbuild/default: default/WarningsInsideNodeModules":
    "written: the build: 1 | return |     ^ | error: TS1108: A 'return' statement can only be used withi",
  "esbuild/default: default/WithStatementTaintingNoBundle":
    "bundled: the build: 6 |   with ({ outer: 100, local: 150, hoisted: 200, extra: 500 }) { |       ^ |",
  "esbuild/extra: extra/BracketAccess1":
    "each file: code bytes 66 -> 12, operations 2 -> 0, run-time operations 236 -> 234; bundled: code bytes 66 -> 12, operations 2 -> 0, run-time operations 236 -> 234",
  "esbuild/extra: extra/BracketAccess2":
    "each file: code bytes 66 -> 12, operations 2 -> 0, run-time operations 236 -> 234; bundled: code bytes 66 -> 12, operations 2 -> 0, run-time operations 236 -> 234",
  "esbuild/extra: extra/BracketAccess20":
    "written: the build: 1 | Object.defineProperty(Object.prototype, 'MIN_OBJ_LIT', {value: 1}) |       ",
  "esbuild/extra: extra/BracketAccess3":
    "each file: code bytes 66 -> 12, operations 2 -> 0, run-time operations 236 -> 234; bundled: code bytes 66 -> 12, operations 2 -> 0, run-time operations 236 -> 234",
  "esbuild/extra: extra/BracketAccess4":
    "each file: code bytes 66 -> 12, operations 2 -> 0, run-time operations 236 -> 234; bundled: code bytes 66 -> 12, operations 2 -> 0, run-time operations 236 -> 234",
  "esbuild/extra: extra/CJSEval1":
    "written: the build: it may load any file of the executable, so nothing beside it is compiled as it ",
  "esbuild/extra: extra/CJSEval2":
    "written: the build: it may load any file of the executable, so nothing beside it is compiled as it ",
  "esbuild/extra: extra/CJSSelfExport3":
    "each file: the build: it may load any file of the executable, so nothing beside it is compiled as it ",
  "esbuild/extra: extra/CJSSelfExport4":
    "each file: the build: it may load any file of the executable, so nothing beside it is compiled as it ",
  "esbuild/extra: extra/CJSSelfExport5":
    "each file: the build: it may load any file of the executable, so nothing beside it is compiled as it ",
  "esbuild/extra: extra/CJSSelfExport6":
    "each file: the build: it may load any file of the executable, so nothing beside it is compiled as it ",
  "esbuild/extra: extra/CJSSelfExport7":
    "each file: the build: it may load any file of the executable, so nothing beside it is compiled as it ",
  "esbuild/extra: extra/CJSSelfExport8":
    "each file: the build: it may load any file of the executable, so nothing beside it is compiled as it ",
  "esbuild/extra: extra/CommonJSSymbol1":
    "written: the build: it may load any file of the executable, so nothing beside it is compiled as it ",
  "esbuild/extra: extra/CommonJSSymbol4": "each file: code bytes 258 -> 210, operations 16 -> 10",
  "esbuild/extra: extra/CyclicImport1": "bundled: code bytes 128 -> 66, operations 9 -> 2",
  "esbuild/extra: extra/CyclicImport2":
    "each file: the build: it may load any file of the executable, so nothing beside it is compiled as it ",
  "esbuild/extra: extra/DefineArray":
    "each file: code bytes 66 -> 12, operations 2 -> 0, run-time operations 236 -> 234; bundled: code bytes 66 -> 12, operations 2 -> 0, run-time operations 236 -> 234",
  "esbuild/extra: extra/DefineArray2":
    "each file: code bytes 66 -> 12, operations 2 -> 0, run-time operations 236 -> 234; bundled: code bytes 66 -> 12, operations 2 -> 0, run-time operations 236 -> 234",
  "esbuild/extra: extra/DefineExports1":
    'each file: code bytes 183 -> 12, operations 9 -> 0, run-time operations 238 -> 234; bundled: "error: fail\\n\\nexit 1", bun run "\\nexit 0"; bundled: run-time operations 238 -> 237',
  "esbuild/extra: extra/DefineExports2":
    'each file: code bytes 183 -> 12, operations 9 -> 0, run-time operations 238 -> 234; bundled: "error: fail\\n\\nexit 1", bun run "\\nexit 0"; bundled: run-time operations 238 -> 237',
  "esbuild/extra: extra/DefineExportsArray2":
    'each file: code bytes 183 -> 12, operations 9 -> 0, run-time operations 238 -> 234; bundled: "error: fail\\n\\nexit 1", bun run "\\nexit 0"; bundled: run-time operations 238 -> 237',
  "esbuild/extra: extra/DefineModuleArray1":
    "written: the build: it may load any file of the executable, so nothing beside it is compiled as it ",
  "esbuild/extra: extra/DefineObject1":
    "each file: code bytes 66 -> 12, operations 2 -> 0, run-time operations 236 -> 234; bundled: code bytes 66 -> 12, operations 2 -> 0, run-time operations 236 -> 234",
  "esbuild/extra: extra/DefineObject2":
    "each file: code bytes 66 -> 12, operations 2 -> 0, run-time operations 236 -> 234; bundled: code bytes 66 -> 12, operations 2 -> 0, run-time operations 236 -> 234",
  "esbuild/extra: extra/DotAccess1":
    "each file: code bytes 66 -> 12, operations 2 -> 0, run-time operations 236 -> 234; bundled: code bytes 66 -> 12, operations 2 -> 0, run-time operations 236 -> 234",
  "esbuild/extra: extra/DotAccess2":
    "each file: code bytes 66 -> 12, operations 2 -> 0, run-time operations 236 -> 234; bundled: code bytes 66 -> 12, operations 2 -> 0, run-time operations 236 -> 234",
  "esbuild/extra: extra/DotAccess20":
    "written: the build: 1 | Object.defineProperty(Object.prototype, 'MIN_OBJ_LIT', {value: 1}) |       ",
  "esbuild/extra: extra/DotAccess3":
    "each file: code bytes 66 -> 12, operations 2 -> 0, run-time operations 236 -> 234; bundled: code bytes 66 -> 12, operations 2 -> 0, run-time operations 236 -> 234",
  "esbuild/extra: extra/DotAccess4":
    "each file: code bytes 66 -> 12, operations 2 -> 0, run-time operations 236 -> 234; bundled: code bytes 66 -> 12, operations 2 -> 0, run-time operations 236 -> 234",
  "esbuild/extra: extra/DoubleExportStar1": "bundled: code bytes 67 -> 12, run-time operations 236 -> 234",
  "esbuild/extra: extra/DoubleExportStar2":
    "each file: the build: it may load any file of the executable, so nothing beside it is compiled as it ",
  "esbuild/extra: extra/DoubleExportStar3":
    "each file: the build: it may load any file of the executable, so nothing beside it is compiled as it ",
  "esbuild/extra: extra/ESBuildIssue758": "bundled: operations 10 -> 7",
  "esbuild/extra: extra/FunctionHoisting1":
    'bundled: "\\nexit 0", bun run "error: fail\\n\\nexit 1"; bundled: run-time operations 238 -> 237',
  "esbuild/extra: extra/FunctionHoisting13":
    'written: "error: ReferenceError: f is not defined\\n      at /$bunfs/root/c000/in.js:2:5\\n\\n\\nexit 1; each file: "error: ReferenceError: f is not defined\\n      at /$bunfs/root/c000/in.js:6:5\\n\\n\\nexit 1; bundled: "\\nexit 0", bun run "error: 1 | x: function f() { return 1 }\\n2 | if (f() !== 1) throw \'fa; bundled: code bytes 126 -> 65, operations 8 -> 2, run-time operations 240 -> 236',
  "esbuild/extra: extra/FunctionHoisting14":
    'written: "error: ReferenceError: f is not defined\\n      at /$bunfs/root/c000/in.ts:10:53\\n\\n\\nexit; each file: "error: ReferenceError: f is not defined\\n      at /$bunfs/root/c000/in.js:21:53\\n\\n\\nexit; bundled: "\\nexit 0", bun run "error:  5 |   for (var c in { c: 0 }) ;\\n 6 |   for (var d of [\'d\']) ; bundled: code bytes 1765 -> 1740, operations 50 -> 46, run-time operations 244 -> 243',
  "esbuild/extra: extra/FunctionHoisting15":
    'written: "error: ReferenceError: f is not defined\\n      at /$bunfs/root/c000/in.ts:10:53\\n\\n\\nexit; each file: "error: ReferenceError: f is not defined\\n      at /$bunfs/root/c000/in.js:21:53\\n\\n\\nexit; bundled: "\\nexit 0", bun run "error:  5 |   for (var c in { c: 0 }) ;\\n 6 |   for (var d of [\'d\']) ; bundled: code bytes 1765 -> 1740, operations 50 -> 46, run-time operations 244 -> 243',
  "esbuild/extra: extra/FunctionHoisting4":
    'bundled: "\\nexit 0", bun run "error: fail\\n\\nexit 1"; bundled: run-time operations 238 -> 237',
  "esbuild/extra: extra/FunctionHoisting5":
    'bundled: "\\nexit 0", bun run "error: fail\\n\\nexit 1"; bundled: run-time operations 238 -> 237',
  "esbuild/extra: extra/FunctionHoisting8":
    'bundled: "\\nexit 0", bun run "error: fail\\n\\nexit 1"; bundled: run-time operations 238 -> 237',
  "esbuild/extra: extra/FunctionHoistingKeepNames1":
    'written: "error: TypeError: undefined is not an object (evaluating \'undefined.name\')\\n      at /$bu; each file: "error: TypeError: undefined is not an object (evaluating \'undefined.name\')\\n      at /$bu; bundled: "error: fail: f2\\n\\nexit 1", bun run "error: 1 | var f\\n2 | if (1) function f() { return f',
  "esbuild/extra: extra/FunctionHoistingKeepNames2":
    'written: "error: TypeError: undefined is not an object (evaluating \'undefined.name\')\\n      at /$bu; each file: "error: TypeError: undefined is not an object (evaluating \'undefined.name\')\\n      at /$bu; bundled: "error: fail: f2\\n\\nexit 1", bun run "error: 1 | var f\\n2 | if (1) function f() { return f',
  "esbuild/extra: extra/FunctionHoistingKeepNames3":
    'written: "error: ReferenceError: f is not defined\\n      at /$bunfs/root/c000/in.ts:10:53\\n\\n\\nexit; each file: "error: ReferenceError: f is not defined\\n      at /$bunfs/root/c000/in.js:19:53\\n\\n\\nexit; bundled: "\\nexit 0", bun run "error:  5 |   for (var c in { c: 0 }) ;\\n 6 |   for (var d of [\'d\']) ',
  "esbuild/extra: extra/FunctionHoistingKeepNames4":
    'written: "error: ReferenceError: f is not defined\\n      at /$bunfs/root/c000/in.ts:10:53\\n\\n\\nexit; each file: "error: ReferenceError: f is not defined\\n      at /$bunfs/root/c000/in.js:19:53\\n\\n\\nexit; bundled: "\\nexit 0", bun run "error:  5 |   for (var c in { c: 0 }) ;\\n 6 |   for (var d of [\'d\']) ',
  "esbuild/extra: extra/ImportOrder1":
    "bundled: code bytes 311 -> 137, operations 15 -> 7, run-time operations 239 -> 238",
  "esbuild/extra: extra/ImportOrder2":
    "bundled: code bytes 316 -> 146, operations 16 -> 8, run-time operations 239 -> 238",
  "esbuild/extra: extra/MinifyBracketAccess1":
    "each file: code bytes 66 -> 12, operations 2 -> 0, run-time operations 236 -> 234; bundled: code bytes 66 -> 12, operations 2 -> 0, run-time operations 236 -> 234",
  "esbuild/extra: extra/MinifyBracketAccess2":
    "each file: code bytes 66 -> 12, operations 2 -> 0, run-time operations 236 -> 234; bundled: code bytes 66 -> 12, operations 2 -> 0, run-time operations 236 -> 234",
  "esbuild/extra: extra/MinifyBracketAccess20":
    "written: the build: 1 | Object.defineProperty(Object.prototype, 'MIN_OBJ_LIT', {value: 1}) |       ",
  "esbuild/extra: extra/MinifyBracketAccess3":
    "each file: code bytes 66 -> 12, operations 2 -> 0, run-time operations 236 -> 234; bundled: code bytes 66 -> 12, operations 2 -> 0, run-time operations 236 -> 234",
  "esbuild/extra: extra/MinifyBracketAccess4":
    "each file: code bytes 66 -> 12, operations 2 -> 0, run-time operations 236 -> 234; bundled: code bytes 66 -> 12, operations 2 -> 0, run-time operations 236 -> 234",
  "esbuild/extra: extra/MinifyCatchScope4": "bundled: operations 15 -> 14",
  "esbuild/extra: extra/MinifyCatchScope5": "bundled: operations 105 -> 104",
  "esbuild/extra: extra/MinifyDotAccess1":
    "each file: code bytes 66 -> 12, operations 2 -> 0, run-time operations 236 -> 234; bundled: code bytes 66 -> 12, operations 2 -> 0, run-time operations 236 -> 234",
  "esbuild/extra: extra/MinifyDotAccess2":
    "each file: code bytes 66 -> 12, operations 2 -> 0, run-time operations 236 -> 234; bundled: code bytes 66 -> 12, operations 2 -> 0, run-time operations 236 -> 234",
  "esbuild/extra: extra/MinifyDotAccess20":
    "written: the build: 1 | Object.defineProperty(Object.prototype, 'MIN_OBJ_LIT', {value: 1}) |       ",
  "esbuild/extra: extra/MinifyDotAccess3":
    "each file: code bytes 66 -> 12, operations 2 -> 0, run-time operations 236 -> 234; bundled: code bytes 66 -> 12, operations 2 -> 0, run-time operations 236 -> 234",
  "esbuild/extra: extra/MinifyDotAccess4":
    "each file: code bytes 66 -> 12, operations 2 -> 0, run-time operations 236 -> 234; bundled: code bytes 66 -> 12, operations 2 -> 0, run-time operations 236 -> 234",
  "esbuild/extra: extra/NoMinifyCatchScope4": "bundled: operations 15 -> 14",
  "esbuild/extra: extra/NoMinifyCatchScope5": "bundled: operations 105 -> 104",
  "esbuild/extra: extra/ObjectRestPattern2": "each file: run-time operations 242 -> 241",
  "esbuild/extra: extra/PathWithQuestionMark":
    'written: the build: 1 | import foo from "./file.js?ignore-me"; |     ^ | error: TS100159: bun compile does not support a query string in an imp',
  "esbuild/extra: extra/PrototypeChain1":
    "written: \"error: SyntaxError: Export named 'prop' not found in module '/$bunfs/root/c000/cjs-proto.; each file: \"error: SyntaxError: Export named 'prop' not found in module '/$bunfs/root/c000/cjs-proto.; bundled: \"\\nexit 0\", bun run \"error: SyntaxError: Export named 'prop' not found in module",
  "esbuild/extra: extra/PrototypeChain2":
    "written: \"error: SyntaxError: Export named 'prop' not found in module '/$bunfs/root/c000/cjs-proto.; each file: \"error: SyntaxError: Export named 'prop' not found in module '/$bunfs/root/c000/cjs-proto.; bundled: \"\\nexit 0\", bun run \"error: SyntaxError: Export named 'prop' not found in module",
  "esbuild/extra: extra/PrototypeChain2'": 'bundled: "\\nexit 0", bun run "error: fail\\n\\nexit 1"',
  "esbuild/extra: extra/RemoveASMDirective":
    'written: "error: fail\\n\\nexit 1", bun run "\\nexit 0"; each file: run-time operations 241 -> 239',
  "esbuild/extra: extra/ToplevelSymbolHoisting":
    "each file: code bytes 902 -> 313, operations 33 -> 18; bundled: code bytes 902 -> 313, operations 33 -> 18",
  "esbuild/extra: extra/TreeShaking2":
    'bundled: "\\nexit 0", bun run "error: fail\\n\\nexit 1"; bundled: code bytes 145 -> 12, operations 8 -> 0, run-time operations 240 -> 234',
  "esbuild/extra: extra/TreeShaking4":
    "bundled: code bytes 241 -> 149, operations 13 -> 8, run-time operations 239 -> 238",
  "esbuild/extra: extra/TreeShaking5":
    'bundled: "\\nexit 0", bun run "error: fail\\n\\nexit 1"; bundled: code bytes 232 -> 12, operations 12 -> 0, run-time operations 241 -> 234',
  "esbuild/extra: extra/TreeShaking6":
    "bundled: code bytes 241 -> 149, operations 13 -> 8, run-time operations 239 -> 238",
  "esbuild/extra: extra/TreeShaking7":
    'bundled: "\\nexit 0", bun run "error: expected \\"foo\\" to be tree-shaken\\n\\nexit 1"',
  "esbuild/extra: extra/TreeShaking8":
    'bundled: "error: fail\\n\\nexit 1", bun run "\\nexit 0"; bundled: code bytes 154 -> 96, operations 9 -> 4',
  "esbuild/extra: extra/TypeofRequireESM":
    "each file: code bytes 190 -> 110, operations 11 -> 7; bundled: code bytes 190 -> 110, operations 11 -> 7",
  "esbuild/extra: extra/UnminifiedNamedModuleFunctions1":
    'written: "error: error: Error: fail\\n    at /$bunfs/root/c000/src/b.ts:2:11\\n    at unknown\\n    at; each file: "error: error: Error: fail\\n    at /$bunfs/root/c000/src/b.js:1:7\\n    at unknown\\n    at ; bundled: "error: error: Error: fail\\n    at <anonymous> (/$bunfs/root/c000/entry.js:17:14)\\n    at ; bundled: run-time operations 248 -> 245',
  "esbuild/extra: extra/UnminifiedNamedModuleFunctions2":
    'written: "error: error: Error: fail\\n    at /$bunfs/root/c000/src/b.ts:2:11\\n    at unknown\\n    at; each file: "\\nexit 0", bun run "error: 1 | try {\\n2 |   require(\'./src/a\')\\n3 | } catch (e) {\\n4 |   ; bundled: "\\nexit 0", bun run "error: 1 | try {\\n2 |   require(\'./src/a\')\\n3 | } catch (e) {\\n4 |   ; bundled: run-time operations 251 -> 249',
  "esbuild/extra: extra/UnminifiedNamedModuleFunctions3":
    'written: "error: error: Error: fail\\n    at /$bunfs/root/c000/src/b.ts:2:34\\n    at unknown\\n    at; each file: the build: it may load any file of the executable, so nothing beside it is compiled as it ; bundled: "error: error: Error: fail\\n    at <anonymous> (/$bunfs/root/c000/entry.js:17:14)\\n    at ',
  "esbuild/extra: extra/UnminifiedNamedModuleFunctions4":
    'written: "error: error: Error: fail\\n    at /$bunfs/root/c000/src/b.ts:2:34\\n    at unknown\\n    at; each file: the build: it may load any file of the executable, so nothing beside it is compiled as it ; bundled: "\\nexit 0", bun run "error: 1 | try {\\n2 |   require(\'./src/a\')\\n3 | } catch (e) {\\n4 |   ',
  "esbuild/importstar: importstar/ExportOtherCommonJS":
    "bundled: the build: 3 |   __INVALID__REF__ as bar |       ^ | error: TS2661: Cannot export '__INVAL",
  "esbuild/importstar: importstar/ExportOtherNestedCommonJS": "bundled: code bytes 249 -> 12, operations 14 -> 0",
  "esbuild/importstar: importstar/ExportSelfAndRequireSelfCommonJS":
    "each file: the build: it may load any file of the executable, so nothing beside it is compiled as it ",
  "esbuild/importstar: importstar/ImportNamespaceUndefinedPropertyEmptyFile": "bundled: code bytes 222 -> 107",
  "esbuild/importstar: importstar/ImportNamespaceUndefinedPropertyEmptyFile #2":
    "bundled: code bytes 303 -> 128, operations 16 -> 6",
  "esbuild/importstar: importstar/ImportSelfCommonJS":
    "written: the build: 2 | import {foo} from './entry' |     ^ | error: TS100106: Cannot use import st",
  "esbuild/importstar: importstar/ImportStarAndCommonJS":
    "each file: the build: it may load any file of the executable, so nothing beside it is compiled as it ; bundled: operations 7 -> 5",
  "esbuild/importstar: importstar/ImportStarCommonJSCapture":
    'bundled: "{\\"foo\\":123} 123 234\\n\\nexit 0", bun run "{\\"default\\":{\\"foo\\":123},\\"foo\\":123} 123 23',
  "esbuild/importstar: importstar/ImportStarNoBundleUnused":
    "written: the build: 1 | import * as ns from './foo' |     ^ | error: TS100150: Could not resolve: \"",
  "esbuild/importstar: importstar/MemberOfExportDefaultImportChain":
    "bundled: code bytes 206 -> 118, operations 13 -> 6, run-time operations 240 -> 239",
  "esbuild/importstar: importstar/MemberOfExportDefaultImportCycleTDZ":
    'bundled: "function object 1\\n\\nexit 0", bun run "ReferenceError object 1\\n\\nexit 0"; bundled: code bytes 465 -> 210, operations 34 -> 13, run-time operations 243 -> 239',
  "esbuild/importstar: importstar/MemberOfExportDefaultImportSnapshot":
    "bundled: code bytes 200 -> 154, operations 14 -> 9",
  "esbuild/importstar: importstar/MemberOfNamespaceAssignThroughMember":
    "bundled: code bytes 181 -> 105, operations 11 -> 5, run-time operations 241 -> 239",
  "esbuild/importstar: importstar/MemberOfReExportedImportStar": "bundled: code bytes 181 -> 118, operations 10 -> 6",
  "esbuild/importstar: importstar/NamespaceImportMissingCommonJS":
    'bundled: "{\\"x\\":123} undefined\\n\\nexit 0", bun run "{\\"default\\":{\\"x\\":123},\\"x\\":123} undefined\\',
  "esbuild/importstar: importstar/NamespaceImportUnusedMissingCommonJS":
    "bundled: code bytes 200 -> 97, operations 8 -> 4, run-time operations 239 -> 238",
  "esbuild/importstar: importstar/NamespaceOwnKeysSorted":
    'written: "$dollar,Alpha,_under,beta,default,zed\\nerror: TypeError: Cannot convert a symbol to a str; each file: "$dollar,Alpha,_under,beta,default,zed\\nerror: TypeError: Cannot convert a symbol to a str; bundled: "$dollar,Alpha,_under,beta,default,zed\\n$dollar,Alpha,_under,beta,default,zed\\n$dollar,Alp',
  "esbuild/importstar: importstar/ReExportStarNameCollisionNotAmbiguousExport": "bundled: code bytes 30 -> 12",
  "esbuild/importstar_ts: importstar_ts/CommonJSCapture":
    'bundled: "{\\"foo\\":123} 123 234\\n\\nexit 0", bun run "{\\"default\\":{\\"foo\\":123},\\"foo\\":123} 123 23',
  "esbuild/importstar_ts: importstar_ts/MangleNoBundleCapture":
    "written: the build: 2 | import * as ns from './foo' |     ^ | error: TS100150: Could not resolve: \"",
  "esbuild/importstar_ts: importstar_ts/MangleNoBundleNoCapture":
    "written: the build: 2 | import * as ns from './foo' |     ^ | error: TS100150: Could not resolve: \"",
  "esbuild/importstar_ts: importstar_ts/NoBundleCapture":
    "written: the build: 2 | import * as ns from './foo' |     ^ | error: TS100150: Could not resolve: \"",
  "esbuild/importstar_ts: importstar_ts/NoBundleNoCapture":
    "written: the build: 2 | import * as ns from './foo' |     ^ | error: TS100150: Could not resolve: \"",
  "esbuild/importstar_ts: importstar_ts/ReExportTypeOnlyFileES6":
    'each file: the build: 1 | import { Foo } from "./type"; |              ^ | error: TS100200: No matching export in "c000/type.js" for imp; |              ^; bundled: operations 16 -> 9',
  "esbuild/importstar_ts: importstar_ts/TSAndCommonJS":
    "each file: the build: it may load any file of the executable, so nothing beside it is compiled as it ; bundled: operations 7 -> 5",
  "esbuild/ts: ts/EnumCrossModuleInliningDefinitions": "bundled: code bytes 194085 -> 193979, operations 9315 -> 9310",
  "esbuild/ts: ts/EnumCrossModuleTreeShaking": "bundled: code bytes 1592 -> 1396, operations 83 -> 68",
  "esbuild/ts: ts/EnumDefine":
    'written: "error: ReferenceError: b is not defined\\n      at /$bunfs/root/c000/entry.ts:2:23\\n\\n\\nex; each file: "error: ReferenceError: b is not defined\\n      at <anonymous> (/$bunfs/root/c000/entry.js; bundled: "error: ReferenceError: b is not defined\\n      at <anonymous> (/$bunfs/root/c000/entry.js',
  "esbuild/ts: ts/EnumRulesFrom_TypeScript_5_0":
    "each file: code bytes 1836 -> 1274, operations 80 -> 79; bundled: code bytes 1836 -> 126, operations 80 -> 6",
  "esbuild/ts: ts/EnumRulesFrom_TypeScript_5_0 #2":
    "written: the build: it may load any file of the executable, so nothing beside it is compiled as it ",
  "esbuild/ts: ts/EnumTreeShaking #3": "bundled: code bytes 193 -> 106",
  "esbuild/ts: ts/ExportDefaultTypeESBuildIssue316": "bundled: code bytes 300 -> 205, operations 20 -> 13",
  "esbuild/ts: ts/ExportEquals":
    'each file: the build: 1 | import b from "./b.ts"; |     ^ | error: TS100150: Could not resolve: "./b.ts"',
  "esbuild/ts: ts/ExportMissingES6":
    "written: the build: 2 | export {nope} from './bar' |             ^ | error: TS100200: No matching e",
  "esbuild/ts: ts/ExportNamespace":
    'each file: the build: 1 | import { Foo } from "./b.ts"; |     ^ | error: TS100150: Could not resolve: "./b.ts"; bundled: code bytes 342 -> 302, operations 20 -> 15, run-time operations 247 -> 246',
  "esbuild/ts: ts/ImportVsLocalCollisionMixed":
    'each file: the build: 6 | import { real } from "./other.ts"; |     ^ | error: TS100150: Could not resolve: "./other.ts"',
  "esbuild/ts: ts/SideEffectsFalseWarningTypeDeclarations":
    'each file: the build: 2 | import"some-ts"; |     ^ | error: TS100151: Could not resolve: "some-ts". Maybe you need to "bun ; |     ^; bundled: code bytes 150 -> 12, operations 8 -> 0',
  "esbuild/ts: ts/TypeScriptDecorators":
    "written: the build: 3 |         @new y?.[_ + 'x']() |                   ^ | error: TS1209: Invalid ",
  "files are linked: a constant read before its file has run [js]": "bundled: code bytes 162 -> 129, operations 9 -> 5",
  "files are linked: a constant read before its file has run [ts]": "bundled: code bytes 162 -> 129, operations 9 -> 5",
  "files are linked: a namespace of another file [ts]": "bundled: operations 15 -> 11",
  "files are linked: a namespace read for a name that is not there [js]":
    "bundled: operations 7 -> 5, run-time operations 239 -> 238",
  "namespaces: a constant of a namespace [ts, two files]":
    "each file: run-time operations 241 -> 240; bundled: code bytes 294 -> 115, operations 17 -> 6, run-time operations 241 -> 239",
  "namespaces: a function of a namespace [ts, two files]":
    "each file: operations 22 -> 20; bundled: code bytes 335 -> 293, operations 22 -> 15",
  "namespaces: a namespace in a namespace [ts, two files]": "bundled: operations 17 -> 15",
  "namespaces: a namespace nobody reads [ts, two files]":
    "bundled: code bytes 199 -> 103, operations 10 -> 5, run-time operations 239 -> 238",
  "namespaces: an alias of a member [ts, two files]":
    "bundled: code bytes 224 -> 102, operations 11 -> 5, run-time operations 239 -> 238",
  "process.env, NODE_ENV and what the build knows of the target: process.env.NODE_ENV in brackets [js]":
    "each file: code bytes 171 -> 105, operations 9 -> 5, run-time operations 240 -> 239; bundled: code bytes 171 -> 105, operations 9 -> 5, run-time operations 240 -> 239",
  "process.env, NODE_ENV and what the build knows of the target: process.env.NODE_ENV in brackets [ts]":
    "each file: code bytes 171 -> 105, operations 9 -> 5, run-time operations 240 -> 239; bundled: code bytes 171 -> 105, operations 9 -> 5, run-time operations 240 -> 239",
  "texts, numbers and templates are computed: a character of a text [js]":
    "each file: code bytes 525 -> 243; bundled: code bytes 525 -> 243",
  "texts, numbers and templates are computed: a character of a text [ts]":
    "each file: code bytes 525 -> 243; bundled: code bytes 525 -> 243",
  "texts, numbers and templates are computed: a template around an unknown [js]":
    "each file: code bytes 226 -> 204, operations 14 -> 12; bundled: code bytes 226 -> 204, operations 14 -> 12",
  "texts, numbers and templates are computed: a template around an unknown [ts]":
    "each file: operations 13 -> 12; bundled: operations 13 -> 12",
  "texts, numbers and templates are computed: texts joined around an unknown [js]":
    "each file: operations 12 -> 11; bundled: operations 12 -> 11",
  "texts, numbers and templates are computed: texts joined around an unknown [ts]":
    "each file: operations 12 -> 11; bundled: operations 12 -> 11",
  "texts, numbers and templates are computed: texts joined behind an unknown [js]":
    "each file: operations 11 -> 10; bundled: operations 11 -> 10",
  "texts, numbers and templates are computed: texts joined behind an unknown [ts]":
    "each file: operations 11 -> 10; bundled: operations 11 -> 10",
  "typeof, void, ! and equality of constants: typeof of literals [js]":
    "each file: code bytes 481 -> 425, operations 24 -> 19, run-time operations 249 -> 247; bundled: code bytes 481 -> 425, operations 24 -> 19, run-time operations 249 -> 247",
  "typeof, void, ! and equality of constants: typeof of literals [ts]":
    "each file: code bytes 481 -> 425, operations 24 -> 19, run-time operations 249 -> 247; bundled: code bytes 481 -> 425, operations 24 -> 19, run-time operations 249 -> 247",
  "using: using null and undefined [js]":
    "each file: code bytes 219 -> 147, operations 15 -> 7; bundled: code bytes 219 -> 147, operations 15 -> 7",
  "using: using null and undefined [ts]":
    "each file: code bytes 219 -> 147, operations 15 -> 7; bundled: code bytes 219 -> 147, operations 15 -> 7",
  "what only the checker reads: declared fields [ts]":
    "each file: code bytes 490 -> 468, operations 13 -> 9; bundled: code bytes 490 -> 468, operations 13 -> 9",
};
