// The cases of ../minifying-first-saves-no-code.ts that are larger as written today: by which form of the bundler's, and from how much as written to how much.
// `AOT_REDS=<file> bun test --todo ..` says what they are now.
export const knownToday: Record<string, string> = {
  "--define: typeof of a name [js]":
    'written: "server\\n\\nexit 0", bun run "server\\nerror: BuildMessage: define key \\"typeof window\\" mus; each file: the bundler: error: define key "typeof window" must be a valid identifier; bundled: the bundler: error: define key "typeof window" must be a valid identifier',
  "built-in constructors and calls on constants: a member of a constant object [js, two files]":
    "bundled: code bytes 235 -> 126, operations 15 -> 7, run-time operations 241 -> 239",
  "built-in constructors and calls on constants: a member of a constant object [ts, two files]":
    "bundled: code bytes 235 -> 126, operations 15 -> 7, run-time operations 241 -> 239",
  "built-in constructors and calls on constants: a member of a frozen object [js, two files]":
    "bundled: code bytes 221 -> 186, operations 10 -> 7",
  "built-in constructors and calls on constants: a member of an object as const [js, two files]":
    "bundled: code bytes 165 -> 102, operations 9 -> 5, run-time operations 239 -> 238",
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
  "bundler_minify: minify/BunRequireStatement": "written: the build: at entry.js:2:18",
  "bundler_minify: minify/IdentifiersDollarStillUsableWhenReferenced": "bundled: code bytes 2739 -> 2684",
  "bundler_minify: minify/ImportMetaHotTreeShaking": "written: the build: at entry.ts:17:16",
  "bundler_minify: minify/Infinity":
    "each file: code bytes 386 -> 321, operations 34 -> 31; bundled: code bytes 386 -> 321, operations 34 -> 31",
  "bundler_minify: minify/NoBundleExportNameNotReusedAtTopLevel": "bundled: code bytes 378 -> 353, operations 24 -> 22",
  "bundler_minify: minify/NumericPropertyKeysPrintedAsComputed":
    "bundled: code bytes 614 -> 493, operations 36 -> 26, run-time operations 257 -> 250",
  "bundler_minify: minify/RequireBunAfterKeyword":
    "written: the build: it may load any file of the executable, so nothing beside it is compiled as it ",
  "bundler_minify: minify/RequireEsmWithoutInitAfterKeyword":
    "each file: the build: it may load any file of the executable, so nothing beside it is compiled as it ; bundled: code bytes 176952 -> 176431, run-time operations 325 -> 321",
  "bundler_minify: minify/RequireEsmWithoutInitAfterKeywordAllMinify":
    "each file: the build: it may load any file of the executable, so nothing beside it is compiled as it ; bundled: code bytes 176952 -> 176431, run-time operations 325 -> 312",
  "bundler_minify: minify/RequireMainToImportMetaMain":
    "each file: code bytes 315 -> 235, operations 27 -> 23; bundled: code bytes 315 -> 212, operations 27 -> 21",
  "bundler_minify: minify/SameTargetDestructuringSkipsUnstableTarget": "bundled: operations 9598 -> 9560",
  "bundler_minify: minify/SingleUseSubstitutionIntoEachChild":
    "written: the build: it may load any file of the executable, so nothing beside it is compiled as it ",
  "bundler_minify: minify/StringAdditionFolding":
    "each file: code bytes 659 -> 625, operations 22 -> 20; bundled: code bytes 659 -> 625, operations 22 -> 20",
  "bundler_minify: minify/TypeOfRequire":
    "each file: code bytes 190 -> 110, operations 11 -> 7; bundled: code bytes 190 -> 110, operations 11 -> 7",
  "bundler_minify: minify/UnusedInCommaExpression": "each file: code bytes 390 -> 362; bundled: code bytes 390 -> 362",
  "bundler_minify: minify/WithStatementPinnedNameNotReusedByEnclosingScope":
    "bundled: the build: error: TS1101: 'with' statements are not allowed in strict mode.",
  "bundler_minify: minify/WithStatementPinnedNameNotReusedByEnclosingScopeNoBundle":
    "bundled: the build: error: TS1101: 'with' statements are not allowed in strict mode.",
  "bundler_minify: minify/WithStatementPinnedNameNotReusedWithoutMinify":
    "bundled: the build: error: TS1101: 'with' statements are not allowed in strict mode.",
  "bundler_minify_symbol_for: minify/SymbolForEdgeCases":
    "each file: code bytes 232 -> 192, operations 15 -> 12; bundled: code bytes 232 -> 192, operations 15 -> 12",
  "bundler_minify_symbol_for: minify/SymbolForProduction":
    "each file: code bytes 158 -> 141, operations 10 -> 9; bundled: code bytes 158 -> 141, operations 10 -> 9",
  "bundler_minify_symbol_for: minify/SymbolForRuntimeOverride":
    "written: the build: error: TS100014: this assignment always throws: built-in objects are read-only ",
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
  "classes: a static block that assigns [ts]":
    "each file: code bytes 186 -> 131, operations 12 -> 7, run-time operations 242 -> 238; bundled: code bytes 186 -> 131, operations 12 -> 7, run-time operations 242 -> 238",
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
  "constants are put where their names stand: a constant as a property key [ts, two files]":
    "each file: code bytes 191 -> 129, operations 9 -> 6, run-time operations 241 -> 240; bundled: code bytes 191 -> 158",
  "constants are put where their names stand: a constant as a property key [ts]":
    "each file: code bytes 190 -> 128, operations 9 -> 6, run-time operations 241 -> 240; bundled: code bytes 190 -> 128, operations 9 -> 6, run-time operations 241 -> 240",
  "constants are put where their names stand: inside an arrow in a loop [ts, two files]":
    "each file: code bytes 2389 -> 2297, operations 86 -> 74; bundled: code bytes 2389 -> 2296, operations 86 -> 74",
  "constants are put where their names stand: inside an arrow in a loop [ts]":
    "each file: code bytes 2388 -> 2296, operations 86 -> 74; bundled: code bytes 2388 -> 2296, operations 86 -> 74",
  "enums: a const enum [ts, two files]":
    "bundled: code bytes 381 -> 207, operations 20 -> 10, run-time operations 245 -> 240",
  "enums: a const enum [ts]": "bundled: code bytes 400 -> 207, operations 18 -> 10, run-time operations 245 -> 240",
  "enums: a declared const enum [ts]":
    'written: "error: ReferenceError: Outside is not defined\\n      at /$bunfs/root/c002/entry.ts:2:13\\n; each file: "error: ReferenceError: Outside is not defined\\n      at /$bunfs/root/c002/entry.js:1:13\\n; bundled: "error: ReferenceError: Outside is not defined\\n      at /$bunfs/root/c002/entry.js:3:20\\n',
  "enums: a member as a case label [ts, two files]":
    "bundled: code bytes 513 -> 339, operations 24 -> 10, run-time operations 245 -> 241",
  "enums: a member as a case label [ts]":
    "bundled: code bytes 466 -> 339, operations 17 -> 10, run-time operations 245 -> 241",
  "enums: a member as a key [ts, two files]":
    "bundled: code bytes 213 -> 134, operations 10 -> 6, run-time operations 241 -> 240",
  "enums: a member as a key [ts]":
    "each file: code bytes 212 -> 134, operations 10 -> 6, run-time operations 241 -> 240; bundled: code bytes 212 -> 134, operations 10 -> 6, run-time operations 241 -> 240",
  "enums: a member decides a branch [ts, two files]":
    "each file: code bytes 284 -> 267; bundled: code bytes 284 -> 105, operations 18 -> 5, run-time operations 241 -> 238",
  "enums: a member decides a branch [ts]":
    "bundled: code bytes 194 -> 105, operations 10 -> 5, run-time operations 241 -> 238",
  "enums: a member in brackets [ts, two files]":
    "bundled: code bytes 243 -> 100, operations 14 -> 4, run-time operations 241 -> 238",
  "enums: a member in brackets [ts]":
    "bundled: code bytes 189 -> 100, operations 9 -> 4, run-time operations 241 -> 238",
  "enums: a switch on a member [ts, two files]":
    "bundled: code bytes 280 -> 103, operations 19 -> 5, run-time operations 241 -> 238",
  "enums: a switch on a member [ts]":
    "bundled: code bytes 185 -> 103, operations 10 -> 5, run-time operations 241 -> 238",
  "enums: an enum handed out whole [ts, two files]": "bundled: operations 15 -> 13",
  "enums: an enum in two parts [ts, two files]":
    "bundled: code bytes 365 -> 102, operations 19 -> 5, run-time operations 241 -> 238",
  "enums: an enum in two parts [ts]":
    "bundled: code bytes 185 -> 102, operations 11 -> 5, run-time operations 241 -> 238",
  "enums: an enum nobody reads [ts, two files]":
    "bundled: code bytes 182 -> 102, operations 10 -> 5, run-time operations 240 -> 238",
  "enums: an enum nobody reads [ts]":
    "bundled: code bytes 146 -> 102, operations 7 -> 5, run-time operations 240 -> 238",
  "enums: an enum read only by members [ts, two files]":
    "bundled: code bytes 736 -> 367, operations 35 -> 17, run-time operations 246 -> 242",
  "enums: an enum read only by members [ts]":
    "bundled: code bytes 500 -> 370, operations 24 -> 17, run-time operations 246 -> 242",
  "enums: members are computed [ts, two files]":
    "each file: run-time operations 252 -> 244; bundled: code bytes 566 -> 149, operations 34 -> 7, run-time operations 252 -> 238",
  "enums: members are computed [ts]":
    "each file: code bytes 447 -> 375, run-time operations 251 -> 244; bundled: code bytes 447 -> 149, operations 24 -> 7, run-time operations 251 -> 238",
  "enums: members are numbers [ts, two files]":
    "bundled: code bytes 375 -> 119, operations 22 -> 6, run-time operations 242 -> 239",
  "enums: members are numbers [ts]":
    "bundled: code bytes 242 -> 119, operations 13 -> 6, run-time operations 243 -> 239",
  "enums: members name other enums [ts, two files]":
    "bundled: code bytes 222 -> 102, operations 13 -> 5, run-time operations 242 -> 238",
  "enums: members name other enums [ts]":
    "bundled: code bytes 182 -> 102, operations 10 -> 5, run-time operations 242 -> 238",
  "enums: the name of a member [ts, two files]": "bundled: code bytes 268 -> 240, operations 16 -> 14",
  "esbuild/dce: dce/ConstValueInliningBundle #7": "each file: code bytes 153 -> 102, operations 8 -> 5",
  "esbuild/dce: dce/ConstValueInliningBundle #9": "each file: code bytes 153 -> 102, operations 8 -> 5",
  "esbuild/dce: dce/ConstValueInliningDirectEval #6": "each file: operations 9285 -> 9284",
  "esbuild/dce: dce/CrossModuleConstantFolding": "bundled: code bytes 1601 -> 1069, operations 66 -> 34",
  "esbuild/dce: dce/CrossModuleConstantFolding #3": "bundled: code bytes 321 -> 120, operations 21 -> 5",
  "esbuild/dce: dce/DCEOfDestructuringOfUnwrappedRequire":
    "each file: the build: it may load any file of the executable, so nothing beside it is compiled as it ",
  "esbuild/dce: dce/DCETypeOfCompareStringGuardCondition": "bundled: code bytes 836 -> 640, operations 102 -> 70",
  "esbuild/dce: dce/DCEVarExports #2": "bundled: code bytes 295 -> 251",
  "esbuild/dce: dce/DCEVarExports #3":
    "written: the build: it may load any file of the executable, so nothing beside it is compiled as it ",
  "esbuild/dce: dce/DestructuringOfForOfReboundUnwrappedRequire":
    "each file: the build: it may load any file of the executable, so nothing beside it is compiled as it ",
  "esbuild/dce: dce/DestructuringOfImportNamespaceDirectEval": "bundled: code bytes 193655 -> 190519",
  "esbuild/dce: dce/DestructuringOfReboundUnwrappedRequire":
    "each file: the build: it may load any file of the executable, so nothing beside it is compiled as it ",
  "esbuild/dce: dce/JSONLoaderRemoveUnused":
    "bundled: code bytes 157 -> 105, operations 9 -> 5, run-time operations 242 -> 240",
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
    "each file: the build: error: TS1128: Declaration or statement expected.; bundled: the build: error: TS1128: Declaration or statement expected.",
  "esbuild/dce: dce/RemoveUnusedImportsEval":
    'written: the build: error: TS100151: Could not resolve: "a". Maybe you need to "bun install"?',
  "esbuild/dce: dce/TextLoaderRemoveUnused": "bundled: code bytes 130 -> 105, operations 7 -> 5",
  "esbuild/dce: dce/TreeShakingClassEnumKey": "bundled: operations 15 -> 13",
  "esbuild/dce: dce/TreeShakingImportIdentifier": "bundled: code bytes 201 -> 129, operations 8 -> 5",
  "esbuild/dce: dce/TreeShakingInESMWrapper":
    "each file: the build: it may load any file of the executable, so nothing beside it is compiled as it ",
  "esbuild/dce: dce/TreeShakingUnaryOperators":
    "written: the build: error: TS1102: 'delete' cannot be called on an identifier in strict mode.",
  "esbuild/dce: dce/UnreferencedObjectLiteral":
    "each file: code bytes 225 -> 147, operations 14 -> 7, run-time operations 246 -> 240; bundled: code bytes 225 -> 147, operations 14 -> 7, run-time operations 246 -> 240",
  "esbuild/default: default/ArgumentsSpecialCaseNoBundle":
    "written: the build: it may load any file of the executable, so nothing beside it is compiled as it ",
  "esbuild/default: default/AutoExternalBun":
    "written: the build: error: TS100152: No such built-in module: node:what-is-this",
  "esbuild/default: default/AutoExternalNode":
    "written: the build: error: TS100152: No such built-in module: node:what-is-this",
  "esbuild/default: default/AwaitImportInsideTry":
    "written: the build: it may load any file of the executable, so nothing beside it is compiled as it ",
  "esbuild/default: default/BundlerUsesMainFieldForCjs": "bundled: run-time operations 240 -> 236",
  "esbuild/default: default/BundlerUsesModuleFieldForEsm":
    'written: "hello index.esm.js\\n\\nexit 0", bun run "hello index.cjs.js\\n\\nexit 0"; each file: "hello index.esm.js\\n\\nexit 0", bun run "hello index.cjs.js\\n\\nexit 0"; bundled: "hello index.esm.js\\n\\nexit 0", bun run "hello index.cjs.js\\n\\nexit 0"; bundled: code bytes 186 -> 105, operations 9 -> 5, run-time operations 239 -> 234',
  "esbuild/default: default/BundlerUsesModuleFieldIfMainDoesNotExistEsm":
    "bundled: code bytes 215 -> 105, operations 11 -> 5, run-time operations 239 -> 234",
  "esbuild/default: default/CircularTLADependency2":
    'written: "error: ReferenceError: Cannot access \'c\' before initialization.\\n      at /$bunfs/root/c0; each file: the build: at entry.js:1:14; bundled: "c\\ng\\ne\\nf\\nd\\nc\\n\\nexit 0", bun run "error: 1 | // @ts-nocheck\\n2 | import { c } from \\"',
  "esbuild/default: default/ConstDeclNotRemovedIfReferencedBeforeDecl": "bundled: run-time operations 238 -> 233",
  "esbuild/default: default/ConstDeclRemovedIfReferencedBeforeAllUses": "bundled: run-time operations 238 -> 233",
  "esbuild/default: default/DefineImportMeta":
    'written: "the process ended: 1 TypeError: Invalid URL |  input: \\"./c000/start-the-case.mjs\\", |   ; | 4 |  | 5 | const mark = process.env.AOT_MARK; | 6 | for (const program of JSON.parse(readFileSync(process.env.AOT_TASKS, \\"utf; each file: "the process ended: 1 TypeError: Invalid URL |  input: \\"./c000/start-the-case.mjs\\", |   ; | 4 |  | 5 | const mark = process.env.AOT_MARK; | 6 | for (const program of JSON.parse(readFileSync(process.env.AOT_TASKS, \\"utf; each file: code bytes 229 -> 169, operations 11 -> 9; bundled: "the process ended: 1 TypeError: Invalid URL |  input: \\"./c000/start-the-case.mjs\\", |   ; | 4 |  | 5 | const mark = process.env.AOT_MARK; | 6 | for (const program of JSON.parse(readFileSync(process.env.AOT_TASKS, \\"utf; bundled: code bytes 229 -> 169, operations 11 -> 9',
  "esbuild/default: default/DefineOptionalChain":
    "each file: code bytes 173487 -> 173462, operations 8241 -> 8239; bundled: code bytes 173487 -> 173462, operations 8241 -> 8239",
  "esbuild/default: default/DefineOptionalChainLowered":
    "each file: code bytes 173667 -> 173642, operations 8253 -> 8251; bundled: code bytes 173667 -> 173642, operations 8253 -> 8251",
  "esbuild/default: default/DirectEvalTainting2NoBundle":
    "written: the build: it may load any file of the executable, so nothing beside it is compiled as it ",
  "esbuild/default: default/DirectEvalTaintingNoBundle":
    "written: the build: it may load any file of the executable, so nothing beside it is compiled as it ",
  "esbuild/default: default/DotImport": "bundled: code bytes 197 -> 102, operations 10 -> 5",
  "esbuild/default: default/DynamicImportWithExpressionCJS": "written: the build: at a.js:1:8",
  "esbuild/default: default/ES6FromCommonJS": "bundled: run-time operations 243 -> 239",
  "esbuild/default: default/ExportFSNodeInCommonJSModule":
    "written: the build: error: TS100106: Cannot use import statement with CommonJS-only features",
  "esbuild/default: default/ExportFormsWithMinifyIdentifiersAndNoBundle":
    'written: the build: error: TS100150: Could not resolve: "./f"',
  "esbuild/default: default/ExportsAndModuleFormatCommonJS":
    "written: the build: error: TS100106: Cannot use import statement with CommonJS-only features",
  "esbuild/default: default/ExternalWildcardDoesNotMatchEntryPoint":
    'written: the build: error: TS100151: Could not resolve: "foo". Maybe you need to "bun install"?',
  "esbuild/default: default/ImportFormsWithMinifyIdentifiersAndNoBundle": "written: the build: at entry.js:9:22",
  "esbuild/default: default/ImportFormsWithNoBundle": "written: the build: at entry.js:9:22",
  "esbuild/default: default/ImportMissingCommonJS":
    "written: \"error: SyntaxError: Export named 'y' not found in module '/$bunfs/root/c011/foo.js'.\\n   ; each file: \"error: SyntaxError: Export named 'y' not found in module '/$bunfs/root/c011/foo.js'.\\n   ; bundled: \"123 123 undefined\\n\\nexit 0\", bun run \"error: SyntaxError: Export named 'y' not found in ; bundled: code bytes 354 -> 110, operations 22 -> 5",
  "esbuild/default: default/ImportMissingNeitherES6NorCommonJS":
    'written: the build: error: TS100200: No matching export in "c012/foo.js" for import "default"',
  "esbuild/default: default/ImportThenCatch":
    "written: the build: it may load any file of the executable, so nothing beside it is compiled as it ",
  "esbuild/default: default/ImportWithHashInPath": "bundled: code bytes 165 -> 115, operations 10 -> 6",
  "esbuild/default: default/ImportWithHashParameter":
    'written: the build: error: TS100150: Could not resolve: "./file.txt#foo"',
  "esbuild/default: default/ImportWithQueryParameter":
    "written: the build: error: TS100159: bun compile does not support a query string in an import path:",
  "esbuild/default: default/MinifiedDynamicImportWithExpressionCJS": "written: the build: at a.js:1:8",
  "esbuild/default: default/MinifiedExportsAndModuleFormatCommonJS":
    "written: the build: error: TS100106: Cannot use import statement with CommonJS-only features",
  "esbuild/default: default/MinifyArguments":
    "written: the build: error: TS1215: Invalid use of 'arguments'. Modules are automatically in strict ",
  "esbuild/default: default/NestedES6FromCommonJS": "bundled: run-time operations 241 -> 239",
  "esbuild/default: default/NonDeterminismESBuildIssue2537": "bundled: code bytes 102 -> 12, operations 5 -> 0",
  "esbuild/default: default/ReExportDefaultNoBundle": 'written: the build: error: TS100150: Could not resolve: "./foo"',
  "esbuild/default: default/RequireAndDynamicImportInvalidTemplate": "written: the build: at test.js:3:8",
  "esbuild/default: default/RequireBadArgumentCount": "written: the build: at entry.js:2:15",
  "esbuild/default: default/RequireFSBrowser": "bundled: code bytes 1850887 -> 1848842",
  "esbuild/default: default/RequireProperlyHandlesNamedExportDeclsInCjsModule":
    "bundled: operations 34 -> 24, run-time operations 240 -> 235",
  "esbuild/default: default/RequirePropertyAccessCommonJS":
    "written: the build: it may load any file of the executable, so nothing beside it is compiled as it ",
  "esbuild/default: default/RequireTxt":
    'written: "This is a` test.\\n\\n\\nexit 0", bun run "Module {\\n  default: \\"This is a` test.\\\\n\\",\\n}\\; each file: "This is a` test.\\n\\n\\nexit 0", bun run "Module {\\n  default: \\"This is a` test.\\\\n\\",\\n}\\; bundled: "This is a` test.\\n\\n\\nexit 0", bun run "Module {\\n  default: \\"This is a` test.\\\\n\\",\\n}\\',
  "esbuild/default: default/RequireWithCallInsideTry": "written: the build: at entry.js:2:33",
  "esbuild/default: default/RuntimeUsesMainFieldForCjs": "bundled: run-time operations 240 -> 236",
  "esbuild/default: default/RuntimeUsesMainFieldForEsm":
    'written: "hello index.esm.js\\n\\nexit 0", bun run "hello index.cjs.js\\n\\nexit 0"; each file: "hello index.esm.js\\n\\nexit 0", bun run "hello index.cjs.js\\n\\nexit 0"; bundled: "hello index.esm.js\\n\\nexit 0", bun run "hello index.cjs.js\\n\\nexit 0"; bundled: code bytes 215 -> 105, operations 11 -> 5, run-time operations 239 -> 234',
  "esbuild/default: default/RuntimeUsesModuleFieldIfMainDoesNotExistEsm":
    "bundled: code bytes 503 -> 105, operations 21 -> 5, run-time operations 239 -> 234",
  "esbuild/default: default/ThisOutsideFunctionNotRenamed":
    "written: the build: it may load any file of the executable, so nothing beside it is compiled as it ",
  "esbuild/default: default/ThisOutsideFunctionRenamedToExports":
    "each file: operations 8267 -> 8266; bundled: operations 8267 -> 8261",
  "esbuild/default: default/ThisUndefinedWarningESM":
    'written: "[ undefined, undefined ] [ undefined, undefined ]\\n\\nexit 0", bun run "[ null, null ] [ n; bundled: code bytes 874 -> 807, operations 35 -> 29, run-time operations 240 -> 235',
  "esbuild/default: default/ThisWithES6Syntax":
    'written: "cjs.js: {}\\nes6-import-assign.ts: {}\\nes6-import-dynamic.js: {}\\nes6-expr-import-dynamic.; each file: the build: it may load any file of the executable, so nothing beside it is compiled as it ; bundled: "cjs.js: {}\\nes6-import-stmt.js: null\\nes6-import-assign.ts: {}\\nes6-import-dynamic.js: {}',
  "esbuild/default: default/ToESMWrapperOmission": "written: the build: at entry.js:29:18",
  "esbuild/default: default/TopLevelAwaitAllowedImportWithoutSplitting":
    'bundled: "0\\n1\\n\\nexit 0", bun run "1\\n0\\n\\nexit 0"',
  "esbuild/default: default/TopLevelAwaitWithNestedRequire":
    "each file: the build: it may load any file of the executable, so nothing beside it is compiled as it ",
  "esbuild/default: default/TopLevelAwaitWithStaticImport": "bundled: code bytes 14457 -> 14428, operations 861 -> 859",
  "esbuild/default: default/UseStrictDirectiveMinifyNoBundle":
    "each file: code bytes 178 -> 99, operations 10 -> 6; bundled: code bytes 178 -> 99, operations 10 -> 6",
  "esbuild/default: default/WarningsInsideNodeModules":
    "written: the build: error: TS1108: A 'return' statement can only be used within a function body.",
  "esbuild/default: default/WithStatementTaintingNoBundle":
    "bundled: the build: error: TS1101: 'with' statements are not allowed in strict mode.",
  "esbuild/extra: extra/ArbitraryModuleNamespaceIdentifiers1":
    "bundled: code bytes 66 -> 12, operations 2 -> 0, run-time operations 236 -> 229",
  "esbuild/extra: extra/ArbitraryModuleNamespaceIdentifiers2":
    "bundled: code bytes 66 -> 12, operations 2 -> 0, run-time operations 236 -> 229",
  "esbuild/extra: extra/ArbitraryModuleNamespaceIdentifiers3":
    "bundled: code bytes 66 -> 12, operations 2 -> 0, run-time operations 236 -> 229",
  "esbuild/extra: extra/ArbitraryModuleNamespaceIdentifiers4":
    "bundled: code bytes 66 -> 12, operations 2 -> 0, run-time operations 236 -> 229",
  "esbuild/extra: extra/ArbitraryModuleNamespaceIdentifiers5":
    "bundled: code bytes 94 -> 12, operations 5 -> 0, run-time operations 236 -> 229",
  "esbuild/extra: extra/ArbitraryModuleNamespaceIdentifiers6":
    "bundled: code bytes 272 -> 12, operations 11 -> 0, run-time operations 236 -> 229",
  "esbuild/extra: extra/BracketAccess1":
    "each file: code bytes 66 -> 12, operations 2 -> 0, run-time operations 236 -> 234; bundled: code bytes 66 -> 12, operations 2 -> 0, run-time operations 236 -> 234",
  "esbuild/extra: extra/BracketAccess2":
    "each file: code bytes 66 -> 12, operations 2 -> 0, run-time operations 236 -> 234; bundled: code bytes 66 -> 12, operations 2 -> 0, run-time operations 236 -> 234",
  "esbuild/extra: extra/BracketAccess20":
    "written: the build: error: TS100014: this assignment always throws: built-in objects are read-only ",
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
  "esbuild/extra: extra/CaseSensitiveImport": "bundled: code bytes 67 -> 12, run-time operations 236 -> 234",
  "esbuild/extra: extra/CaseSensitiveImport4": "bundled: code bytes 67 -> 12, run-time operations 236 -> 234",
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
    "written: the build: error: TS100014: this assignment always throws: built-in objects are read-only ",
  "esbuild/extra: extra/DotAccess3":
    "each file: code bytes 66 -> 12, operations 2 -> 0, run-time operations 236 -> 234; bundled: code bytes 66 -> 12, operations 2 -> 0, run-time operations 236 -> 234",
  "esbuild/extra: extra/DotAccess4":
    "each file: code bytes 66 -> 12, operations 2 -> 0, run-time operations 236 -> 234; bundled: code bytes 66 -> 12, operations 2 -> 0, run-time operations 236 -> 234",
  "esbuild/extra: extra/DoubleExportStar1": "bundled: code bytes 67 -> 12, run-time operations 236 -> 235",
  "esbuild/extra: extra/DoubleExportStar2":
    "each file: the build: it may load any file of the executable, so nothing beside it is compiled as it ",
  "esbuild/extra: extra/DoubleExportStar3":
    "each file: the build: it may load any file of the executable, so nothing beside it is compiled as it ",
  "esbuild/extra: extra/FunctionHoisting1":
    'bundled: "\\nexit 0", bun run "error: fail\\n\\nexit 1"; bundled: run-time operations 240 -> 238',
  "esbuild/extra: extra/FunctionHoisting11":
    "bundled: code bytes 153 -> 12, operations 7 -> 0, run-time operations 237 -> 234",
  "esbuild/extra: extra/FunctionHoisting13":
    'written: "error: ReferenceError: f is not defined\\n      at /$bunfs/root/c002/in.js:2:5\\n\\n\\nexit 1; each file: "error: ReferenceError: f is not defined\\n      at /$bunfs/root/c002/in.js:6:5\\n\\n\\nexit 1; bundled: "\\nexit 0", bun run "error: 1 | x: function f() { return 1 }\\n2 | if (f() !== 1) throw \'fa; bundled: code bytes 126 -> 65, operations 8 -> 2, run-time operations 240 -> 236',
  "esbuild/extra: extra/FunctionHoisting14":
    'written: "error: ReferenceError: f is not defined\\n      at /$bunfs/root/c003/in.ts:10:53\\n\\n\\nexit; each file: "error: ReferenceError: f is not defined\\n      at /$bunfs/root/c003/in.js:21:53\\n\\n\\nexit; bundled: "\\nexit 0", bun run "error:  5 |   for (var c in { c: 0 }) ;\\n 6 |   for (var d of [\'d\']) ; bundled: code bytes 1765 -> 1740, operations 50 -> 46, run-time operations 244 -> 243',
  "esbuild/extra: extra/FunctionHoisting15":
    'written: "error: ReferenceError: f is not defined\\n      at /$bunfs/root/c004/in.ts:10:53\\n\\n\\nexit; each file: "error: ReferenceError: f is not defined\\n      at /$bunfs/root/c004/in.js:21:53\\n\\n\\nexit; bundled: "\\nexit 0", bun run "error:  5 |   for (var c in { c: 0 }) ;\\n 6 |   for (var d of [\'d\']) ; bundled: code bytes 1765 -> 1740, operations 50 -> 46, run-time operations 244 -> 243',
  "esbuild/extra: extra/FunctionHoisting2":
    "each file: run-time operations 239 -> 238; bundled: run-time operations 239 -> 238",
  "esbuild/extra: extra/FunctionHoisting4":
    'bundled: "\\nexit 0", bun run "error: fail\\n\\nexit 1"; bundled: run-time operations 240 -> 238',
  "esbuild/extra: extra/FunctionHoisting5":
    'bundled: "\\nexit 0", bun run "error: fail\\n\\nexit 1"; bundled: run-time operations 239 -> 238',
  "esbuild/extra: extra/FunctionHoisting6":
    "each file: run-time operations 239 -> 238; bundled: run-time operations 239 -> 238",
  "esbuild/extra: extra/FunctionHoisting8":
    'bundled: "\\nexit 0", bun run "error: fail\\n\\nexit 1"; bundled: run-time operations 239 -> 238',
  "esbuild/extra: extra/FunctionHoistingKeepNames1":
    'written: "error: TypeError: undefined is not an object (evaluating \'undefined.name\')\\n      at /$bu; each file: "error: TypeError: undefined is not an object (evaluating \'undefined.name\')\\n      at /$bu; bundled: "error: fail: f2\\n\\nexit 1", bun run "error: 1 | var f\\n2 | if (1) function f() { return f',
  "esbuild/extra: extra/FunctionHoistingKeepNames2":
    'written: "error: TypeError: undefined is not an object (evaluating \'undefined.name\')\\n      at /$bu; each file: "error: TypeError: undefined is not an object (evaluating \'undefined.name\')\\n      at /$bu; bundled: "error: fail: f2\\n\\nexit 1", bun run "error: 1 | var f\\n2 | if (1) function f() { return f',
  "esbuild/extra: extra/FunctionHoistingKeepNames3":
    'written: "error: ReferenceError: f is not defined\\n      at /$bunfs/root/c007/in.ts:10:53\\n\\n\\nexit; each file: "error: ReferenceError: f is not defined\\n      at /$bunfs/root/c007/in.js:19:53\\n\\n\\nexit; bundled: "\\nexit 0", bun run "error:  5 |   for (var c in { c: 0 }) ;\\n 6 |   for (var d of [\'d\']) ',
  "esbuild/extra: extra/FunctionHoistingKeepNames4":
    'written: "error: ReferenceError: f is not defined\\n      at /$bunfs/root/c008/in.ts:10:53\\n\\n\\nexit; each file: "error: ReferenceError: f is not defined\\n      at /$bunfs/root/c008/in.js:19:53\\n\\n\\nexit; bundled: "\\nexit 0", bun run "error:  5 |   for (var c in { c: 0 }) ;\\n 6 |   for (var d of [\'d\']) ',
  "esbuild/extra: extra/ImportOrder1":
    "bundled: code bytes 316 -> 137, operations 16 -> 7, run-time operations 239 -> 233",
  "esbuild/extra: extra/ImportOrder2": "bundled: run-time operations 239 -> 233",
  "esbuild/extra: extra/MinifyBracketAccess1":
    "each file: code bytes 66 -> 12, operations 2 -> 0, run-time operations 237 -> 235; bundled: code bytes 66 -> 12, operations 2 -> 0, run-time operations 237 -> 235",
  "esbuild/extra: extra/MinifyBracketAccess2":
    "each file: code bytes 66 -> 12, operations 2 -> 0, run-time operations 237 -> 235; bundled: code bytes 66 -> 12, operations 2 -> 0, run-time operations 237 -> 235",
  "esbuild/extra: extra/MinifyBracketAccess20":
    "written: the build: error: TS100014: this assignment always throws: built-in objects are read-only ",
  "esbuild/extra: extra/MinifyBracketAccess3":
    "each file: code bytes 66 -> 12, operations 2 -> 0, run-time operations 237 -> 235; bundled: code bytes 66 -> 12, operations 2 -> 0, run-time operations 237 -> 235",
  "esbuild/extra: extra/MinifyBracketAccess4":
    "each file: code bytes 66 -> 12, operations 2 -> 0, run-time operations 237 -> 235; bundled: code bytes 66 -> 12, operations 2 -> 0, run-time operations 237 -> 235",
  "esbuild/extra: extra/MinifyCatchScope4": "bundled: operations 15 -> 14",
  "esbuild/extra: extra/MinifyCatchScope5": "bundled: operations 105 -> 104",
  "esbuild/extra: extra/MinifyDotAccess1":
    "each file: code bytes 66 -> 12, operations 2 -> 0, run-time operations 236 -> 234; bundled: code bytes 66 -> 12, operations 2 -> 0, run-time operations 236 -> 235",
  "esbuild/extra: extra/MinifyDotAccess2":
    "each file: code bytes 66 -> 12, operations 2 -> 0, run-time operations 237 -> 235; bundled: code bytes 66 -> 12, operations 2 -> 0, run-time operations 237 -> 235",
  "esbuild/extra: extra/MinifyDotAccess20":
    "written: the build: error: TS100014: this assignment always throws: built-in objects are read-only ",
  "esbuild/extra: extra/MinifyDotAccess3":
    "each file: code bytes 66 -> 12, operations 2 -> 0, run-time operations 237 -> 235; bundled: code bytes 66 -> 12, operations 2 -> 0, run-time operations 237 -> 235",
  "esbuild/extra: extra/MinifyDotAccess4":
    "each file: code bytes 66 -> 12, operations 2 -> 0, run-time operations 237 -> 235; bundled: code bytes 66 -> 12, operations 2 -> 0, run-time operations 237 -> 235",
  "esbuild/extra: extra/NoMinifyCatchScope4": "bundled: operations 15 -> 14",
  "esbuild/extra: extra/NoMinifyCatchScope5": "bundled: operations 105 -> 104",
  "esbuild/extra: extra/NoMinifyGlobalConstructorBehavior2": "bundled: run-time operations 270 -> 269",
  "esbuild/extra: extra/ObjectRestPattern1":
    "each file: code bytes 2720 -> 2658, operations 116 -> 115; bundled: code bytes 2720 -> 2658, operations 116 -> 115",
  "esbuild/extra: extra/ObjectRestPattern2": "each file: run-time operations 242 -> 241",
  "esbuild/extra: extra/PathWithQuestionMark":
    "written: the build: error: TS100159: bun compile does not support a query string in an import path:",
  "esbuild/extra: extra/PrototypeChain1":
    "written: \"error: SyntaxError: Export named 'prop' not found in module '/$bunfs/root/c027/cjs-proto.; each file: \"error: SyntaxError: Export named 'prop' not found in module '/$bunfs/root/c027/cjs-proto.; bundled: \"\\nexit 0\", bun run \"error: SyntaxError: Export named 'prop' not found in module <path>",
  "esbuild/extra: extra/PrototypeChain2":
    "written: \"error: SyntaxError: Export named 'prop' not found in module '/$bunfs/root/c028/cjs-proto.; each file: \"error: SyntaxError: Export named 'prop' not found in module '/$bunfs/root/c028/cjs-proto.; bundled: \"\\nexit 0\", bun run \"error: SyntaxError: Export named 'prop' not found in module <path>",
  "esbuild/extra: extra/PrototypeChain2'": 'bundled: "\\nexit 0", bun run "error: fail\\n\\nexit 1"',
  "esbuild/extra: extra/RemoveASMDirective":
    'written: "error: fail\\n\\nexit 1", bun run "\\nexit 0"; each file: run-time operations 241 -> 239; bundled: run-time operations 241 -> 239',
  "esbuild/extra: extra/ToplevelSymbolHoisting":
    "each file: code bytes 902 -> 313, operations 33 -> 18; bundled: code bytes 902 -> 313, operations 33 -> 18",
  "esbuild/extra: extra/TreeShaking1": "bundled: operations 10 -> 8",
  "esbuild/extra: extra/TreeShaking2":
    'bundled: "\\nexit 0", bun run "error: fail\\n\\nexit 1"; bundled: code bytes 145 -> 12, operations 8 -> 0, run-time operations 241 -> 238',
  "esbuild/extra: extra/TreeShaking4":
    "bundled: code bytes 241 -> 149, operations 13 -> 8, run-time operations 240 -> 239",
  "esbuild/extra: extra/TreeShaking5":
    'bundled: "\\nexit 0", bun run "error: fail\\n\\nexit 1"; bundled: code bytes 232 -> 12, operations 12 -> 0, run-time operations 242 -> 238',
  "esbuild/extra: extra/TreeShaking6":
    "bundled: code bytes 241 -> 149, operations 13 -> 8, run-time operations 240 -> 239",
  "esbuild/extra: extra/TreeShaking7":
    'bundled: "\\nexit 0", bun run "error: expected \\"foo\\" to be tree-shaken\\n\\nexit 1"',
  "esbuild/extra: extra/TreeShaking8":
    'bundled: "error: fail\\n\\nexit 1", bun run "\\nexit 0"; bundled: code bytes 154 -> 96, operations 9 -> 4',
  "esbuild/extra: extra/TypeofRequireESM":
    "each file: code bytes 190 -> 110, operations 11 -> 7; bundled: code bytes 190 -> 110, operations 11 -> 7",
  "esbuild/extra: extra/UnminifiedNamedModuleFunctions1":
    'written: "error: error: Error: fail\\n    at /$bunfs/root/c031/src/b.ts:2:11\\n    at unknown\\n    at; each file: "error: error: Error: fail\\n    at /$bunfs/root/c031/src/b.js:1:7\\n    at unknown\\n    at ; bundled: "error: error: Error: fail\\n    at <anonymous> (/$bunfs/root/c031/entry.js:17:14)\\n    at ; bundled: run-time operations 248 -> 246',
  "esbuild/extra: extra/UnminifiedNamedModuleFunctions2":
    'written: "error: error: Error: fail\\n    at /$bunfs/root/c032/src/b.ts:2:11\\n    at unknown\\n    at; each file: "\\nexit 0", bun run "error: 1 | try {\\n2 |   require(\'./src/a\')\\n3 | } catch (e) {\\n4 |   ; bundled: "\\nexit 0", bun run "error: 1 | try {\\n2 |   require(\'./src/a\')\\n3 | } catch (e) {\\n4 |   ; bundled: run-time operations 251 -> 250',
  "esbuild/extra: extra/UnminifiedNamedModuleFunctions3":
    'written: "error: error: Error: fail\\n    at /$bunfs/root/c033/src/b.ts:2:34\\n    at unknown\\n    at; each file: the build: it may load any file of the executable, so nothing beside it is compiled as it ; bundled: "error: error: Error: fail\\n    at <anonymous> (/$bunfs/root/c033/entry.js:17:14)\\n    at ',
  "esbuild/extra: extra/UnminifiedNamedModuleFunctions4":
    'written: "error: error: Error: fail\\n    at /$bunfs/root/c034/src/b.ts:2:34\\n    at unknown\\n    at; each file: the build: it may load any file of the executable, so nothing beside it is compiled as it ; bundled: "\\nexit 0", bun run "error: 1 | try {\\n2 |   require(\'./src/a\')\\n3 | } catch (e) {\\n4 |   ',
  "esbuild/importstar: importstar/ExportOtherCommonJS":
    "bundled: the build: error: TS2661: Cannot export '__INVALID__REF__'. Only local declarations can be",
  "esbuild/importstar: importstar/ExportOtherNestedCommonJS": "bundled: code bytes 249 -> 12, operations 14 -> 0",
  "esbuild/importstar: importstar/ExportSelfAndRequireSelfCommonJS":
    "each file: the build: it may load any file of the executable, so nothing beside it is compiled as it ",
  "esbuild/importstar: importstar/ImportExportStarAmbiguous": "bundled: operations 9 -> 5",
  "esbuild/importstar: importstar/ImportNamespaceUndefinedPropertyEmptyFile": "bundled: code bytes 222 -> 107",
  "esbuild/importstar: importstar/ImportNamespaceUndefinedPropertyEmptyFile #2":
    "bundled: code bytes 303 -> 128, operations 16 -> 6",
  "esbuild/importstar: importstar/ImportSelfCommonJS":
    "written: the build: error: TS100106: Cannot use import statement with CommonJS-only features",
  "esbuild/importstar: importstar/ImportStarAndCommonJS":
    "each file: the build: it may load any file of the executable, so nothing beside it is compiled as it ; bundled: operations 7 -> 5",
  "esbuild/importstar: importstar/ImportStarCommonJSCapture":
    'bundled: "{\\"foo\\":123} 123 234\\n\\nexit 0", bun run "{\\"default\\":{\\"foo\\":123},\\"foo\\":123} 123 23',
  "esbuild/importstar: importstar/ImportStarCommonJSNoCapture":
    "bundled: code bytes 204 -> 109, operations 11 -> 6, run-time operations 239 -> 238",
  "esbuild/importstar: importstar/ImportStarNoBundleUnused":
    'written: the build: error: TS100150: Could not resolve: "./foo"',
  "esbuild/importstar: importstar/ImportStarNoCapture": "bundled: operations 8 -> 6",
  "esbuild/importstar: importstar/MemberOfExportDefaultImportChain":
    "bundled: code bytes 206 -> 118, operations 13 -> 6, run-time operations 240 -> 239",
  "esbuild/importstar: importstar/MemberOfExportDefaultImportCycleTDZ":
    'bundled: "function object 1\\n\\nexit 0", bun run "ReferenceError object 1\\n\\nexit 0"; bundled: code bytes 465 -> 210, operations 34 -> 13, run-time operations 243 -> 239',
  "esbuild/importstar: importstar/MemberOfExportDefaultImportSnapshot":
    "bundled: code bytes 200 -> 154, operations 14 -> 9",
  "esbuild/importstar: importstar/MemberOfExportStarAsDefaultFromSelf": "bundled: code bytes 144 -> 118",
  "esbuild/importstar: importstar/MemberOfNamespaceAssignThroughMember":
    "bundled: code bytes 181 -> 105, operations 11 -> 5, run-time operations 241 -> 239",
  "esbuild/importstar: importstar/MemberOfReExportedImportStar": "bundled: code bytes 181 -> 118, operations 10 -> 6",
  "esbuild/importstar: importstar/NamespaceImportMissingCommonJS":
    'bundled: "{\\"x\\":123} undefined\\n\\nexit 0", bun run "{\\"default\\":{\\"x\\":123},\\"x\\":123} undefined\\',
  "esbuild/importstar: importstar/NamespaceImportUnusedMissingCommonJS":
    "bundled: code bytes 200 -> 97, operations 8 -> 4, run-time operations 239 -> 238",
  "esbuild/importstar: importstar/NamespaceOwnKeysSorted":
    'written: "$dollar,Alpha,_under,beta,default,zed\\nerror: TypeError: Cannot convert a symbol to a str; each file: "$dollar,Alpha,_under,beta,default,zed\\nerror: TypeError: Cannot convert a symbol to a str; bundled: "$dollar,Alpha,_under,beta,default,zed\\n$dollar,Alpha,_under,beta,default,zed\\n$dollar,Alp',
  "esbuild/importstar_ts: importstar_ts/CommonJSCapture":
    'bundled: "{\\"foo\\":123} 123 234\\n\\nexit 0", bun run "{\\"default\\":{\\"foo\\":123},\\"foo\\":123} 123 23',
  "esbuild/importstar_ts: importstar_ts/CommonJSNoCapture":
    "bundled: code bytes 204 -> 109, operations 11 -> 6, run-time operations 239 -> 238",
  "esbuild/importstar_ts: importstar_ts/MangleNoBundleCapture":
    'written: the build: error: TS100150: Could not resolve: "./foo"',
  "esbuild/importstar_ts: importstar_ts/MangleNoBundleNoCapture":
    'written: the build: error: TS100150: Could not resolve: "./foo"',
  "esbuild/importstar_ts: importstar_ts/NoBundleCapture":
    'written: the build: error: TS100150: Could not resolve: "./foo"',
  "esbuild/importstar_ts: importstar_ts/NoBundleNoCapture":
    'written: the build: error: TS100150: Could not resolve: "./foo"',
  "esbuild/importstar_ts: importstar_ts/NoCapture": "bundled: operations 8 -> 6",
  "esbuild/importstar_ts: importstar_ts/ReExportTypeOnlyFileES6":
    'each file: the build: error: TS100200: No matching export in "c023/type.js" for import "Foo"; bundled: operations 16 -> 9',
  "esbuild/importstar_ts: importstar_ts/TSAndCommonJS":
    "each file: the build: it may load any file of the executable, so nothing beside it is compiled as it ; bundled: operations 7 -> 5",
  "esbuild/ts: ts/ConstEnumComments":
    "bundled: code bytes 346 -> 166, operations 19 -> 8, run-time operations 249 -> 243",
  "esbuild/ts: ts/EnumCrossModuleInliningAccess":
    "written: the build: only beside the others: it may load any file of the executable, so nothing besi",
  "esbuild/ts: ts/EnumCrossModuleInliningDefinitions":
    "written: the build: only beside the others: it may load any file of the executable, so nothing besi",
  "esbuild/ts: ts/EnumCrossModuleInliningReExport":
    "written: the build: only beside the others: it may load any file of the executable, so nothing besi",
  "esbuild/ts: ts/EnumCrossModuleTreeShaking":
    "written: the build: only beside the others: it may load any file of the executable, so nothing besi",
  "esbuild/ts: ts/EnumDefine":
    'written: "error: ReferenceError: b is not defined\\n      at /$bunfs/root/c000/entry.ts:2:23\\n\\n\\nex; each file: "error: ReferenceError: b is not defined\\n      at <anonymous> (/$bunfs/root/c000/entry.js; bundled: "error: ReferenceError: b is not defined\\n      at <anonymous> (/$bunfs/root/c000/entry.js',
  "esbuild/ts: ts/EnumExportClause": "bundled: code bytes 1215 -> 925, operations 58 -> 39",
  "esbuild/ts: ts/EnumRulesFrom_TypeScript_5_0":
    "each file: code bytes 1836 -> 1274, operations 80 -> 79; bundled: code bytes 1836 -> 126, operations 80 -> 6",
  "esbuild/ts: ts/EnumRulesFrom_TypeScript_5_0 #2":
    "written: the build: it may load any file of the executable, so nothing beside it is compiled as it ",
  "esbuild/ts: ts/EnumSameModuleInliningAccess":
    "written: the build: only beside the others: it may load any file of the executable, so nothing besi",
  "esbuild/ts: ts/EnumTreeShaking":
    "written: the build: only beside the others: it may load any file of the executable, so nothing besi",
  "esbuild/ts: ts/EnumTreeShaking #2":
    "written: the build: only beside the others: it may load any file of the executable, so nothing besi",
  "esbuild/ts: ts/EnumTreeShaking #3":
    "written: the build: only beside the others: it may load any file of the executable, so nothing besi",
  "esbuild/ts: ts/EnumTreeShaking #4":
    "written: the build: only beside the others: it may load any file of the executable, so nothing besi",
  "esbuild/ts: ts/EnumTreeShaking #5":
    "written: the build: only beside the others: it may load any file of the executable, so nothing besi",
  "esbuild/ts: ts/EnumTreeShaking #6":
    "written: the build: only beside the others: it may load any file of the executable, so nothing besi",
  "esbuild/ts: ts/EnumTreeShaking #7":
    "written: the build: only beside the others: it may load any file of the executable, so nothing besi",
  "esbuild/ts: ts/EnumTreeShaking #8":
    "written: the build: only beside the others: it may load any file of the executable, so nothing besi",
  "esbuild/ts: ts/ExportDefaultTypeESBuildIssue316":
    "written: the build: only beside the others: it may load any file of the executable, so nothing besi",
  "esbuild/ts: ts/ExportEquals": 'each file: the build: error: TS100150: Could not resolve: "./b.ts"',
  "esbuild/ts: ts/ExportMissingES6":
    'written: the build: error: TS100200: No matching export in "c036/bar.js" for import "nope"',
  "esbuild/ts: ts/ExportNamespace":
    'each file: the build: error: TS100150: Could not resolve: "./b.ts"; bundled: code bytes 342 -> 302, operations 20 -> 15, run-time operations 247 -> 246',
  "esbuild/ts: ts/ExportTypeSTAR":
    "written: the build: only beside the others: it may load any file of the executable, so nothing besi",
  "esbuild/ts: ts/ImportCTS":
    "written: the build: only beside the others: it may load any file of the executable, so nothing besi",
  "esbuild/ts: ts/ImportEqualsEliminationTest":
    "written: the build: only beside the others: it may load any file of the executable, so nothing besi",
  "esbuild/ts: ts/ImportMTS":
    "written: the build: only beside the others: it may load any file of the executable, so nothing besi",
  "esbuild/ts: ts/ImportVsLocalCollisionAllTypes":
    "written: the build: only beside the others: it may load any file of the executable, so nothing besi",
  "esbuild/ts: ts/ImportVsLocalCollisionMixed":
    "written: the build: only beside the others: it may load any file of the executable, so nothing besi",
  "esbuild/ts: ts/MinifiedBundleCommonJS":
    "written: the build: only beside the others: it may load any file of the executable, so nothing besi",
  "esbuild/ts: ts/MinifiedBundleES6":
    "written: the build: only beside the others: it may load any file of the executable, so nothing besi",
  "esbuild/ts: ts/MinifyDerivedClass":
    "written: the build: only beside the others: it may load any file of the executable, so nothing besi",
  "esbuild/ts: ts/MinifyNamespace":
    "written: the build: only beside the others: it may load any file of the executable, so nothing besi",
  "esbuild/ts: ts/MinifyNamespace #2":
    "written: the build: only beside the others: it may load any file of the executable, so nothing besi",
  "esbuild/ts: ts/MinifyNamespaceNoArrow":
    "written: the build: only beside the others: it may load any file of the executable, so nothing besi",
  "esbuild/ts: ts/MinifyNamespaceNoArrow #2":
    "written: the build: only beside the others: it may load any file of the executable, so nothing besi",
  "esbuild/ts: ts/MinifyNamespaceNoLogicalAssignment":
    "written: the build: only beside the others: it may load any file of the executable, so nothing besi",
  "esbuild/ts: ts/MinifyNamespaceNoLogicalAssignment #2":
    "written: the build: only beside the others: it may load any file of the executable, so nothing besi",
  "esbuild/ts: ts/SiblingEnum":
    "written: the build: only beside the others: it may load any file of the executable, so nothing besi",
  "esbuild/ts: ts/SiblingEnum #2":
    "written: the build: only beside the others: it may load any file of the executable, so nothing besi",
  "esbuild/ts: ts/SiblingEnum #3":
    "written: the build: only beside the others: it may load any file of the executable, so nothing besi",
  "esbuild/ts: ts/SiblingEnum #4":
    "written: the build: only beside the others: it may load any file of the executable, so nothing besi",
  "esbuild/ts: ts/SiblingEnum #5":
    "written: the build: only beside the others: it may load any file of the executable, so nothing besi",
  "esbuild/ts: ts/SiblingEnum #6":
    "written: the build: only beside the others: it may load any file of the executable, so nothing besi",
  "esbuild/ts: ts/SiblingNamespaceClass":
    "written: the build: only beside the others: it may load any file of the executable, so nothing besi",
  "esbuild/ts: ts/SiblingNamespaceEnum":
    "written: the build: only beside the others: it may load any file of the executable, so nothing besi",
  "esbuild/ts: ts/SiblingNamespaceFunction":
    "written: the build: only beside the others: it may load any file of the executable, so nothing besi",
  "esbuild/ts: ts/SiblingNamespaceLet":
    "written: the build: only beside the others: it may load any file of the executable, so nothing besi",
  "esbuild/ts: ts/SiblingNamespaceNamespace":
    "written: the build: only beside the others: it may load any file of the executable, so nothing besi",
  "esbuild/ts: ts/SideEffectsFalseWarningTypeDeclarations":
    "written: the build: only beside the others: it may load any file of the executable, so nothing besi",
  "esbuild/ts: ts/ThisInsideFunctionTS":
    "written: the build: only beside the others: it may load any file of the executable, so nothing besi",
  "esbuild/ts: ts/ThisInsideFunctionTSNoBundle":
    "written: the build: only beside the others: it may load any file of the executable, so nothing besi",
  "esbuild/ts: ts/ThisInsideFunctionTSNoBundleUseDefineForClassFields":
    "written: the build: only beside the others: it may load any file of the executable, so nothing besi",
  "esbuild/ts: ts/TypeScriptDecoratorScopeESBuildIssue2147":
    "written: the build: only beside the others: it may load any file of the executable, so nothing besi",
  "esbuild/ts: ts/TypeScriptDecorators":
    "written: the build: error: TS1209: Invalid optional chain from new expression. Did you mean to call",
  "esbuild/ts: ts/TypeScriptDecoratorsKeepNames":
    "written: the build: only beside the others: it may load any file of the executable, so nothing besi",
  "esbuild/ts: ts/TypeScriptDecoratorsSimpleCase":
    "written: the build: only beside the others: it may load any file of the executable, so nothing besi",
  "expressions nobody reads: unused built-in constructions [js]":
    "each file: operations 6 -> 5, run-time operations 239 -> 238; bundled: operations 6 -> 5, run-time operations 239 -> 238",
  "expressions nobody reads: unused built-in constructions [ts]":
    "each file: operations 6 -> 5, run-time operations 239 -> 238; bundled: operations 6 -> 5, run-time operations 239 -> 238",
  "expressions nobody reads: unused collections [js]":
    "each file: code bytes 822 -> 105, operations 30 -> 5, run-time operations 240 -> 238; bundled: code bytes 822 -> 105, operations 30 -> 5, run-time operations 240 -> 238",
  "expressions nobody reads: unused collections [ts]":
    "each file: code bytes 822 -> 105, operations 30 -> 5, run-time operations 240 -> 238; bundled: code bytes 822 -> 105, operations 30 -> 5, run-time operations 240 -> 238",
  "files are linked: a const enum of another file [ts]":
    "bundled: code bytes 242 -> 105, operations 13 -> 5, run-time operations 242 -> 238",
  "files are linked: a constant read before its file has run [js]": "bundled: code bytes 162 -> 129, operations 9 -> 5",
  "files are linked: a constant read before its file has run [ts]": "bundled: code bytes 162 -> 129, operations 9 -> 5",
  "files are linked: a flag of another file decides what is required [js]":
    "each file: the build: it may load any file of the executable, so nothing beside it is compiled as it ; bundled: code bytes 975122 -> 105, operations 54676 -> 5",
  "files are linked: a member of a JSON file [js]":
    "bundled: code bytes 292 -> 115, operations 17 -> 6, run-time operations 243 -> 239",
  "files are linked: a member of a JSON file [ts]":
    "bundled: code bytes 292 -> 115, operations 17 -> 6, run-time operations 243 -> 239",
  "files are linked: a named member of a JSON file [js]":
    "bundled: code bytes 228 -> 105, operations 14 -> 5, run-time operations 243 -> 239",
  "files are linked: a named member of a JSON file [ts]":
    "bundled: code bytes 228 -> 105, operations 14 -> 5, run-time operations 243 -> 239",
  "files are linked: a namespace exported again [js]": "bundled: operations 8 -> 5",
  "files are linked: a namespace exported again [ts]": "bundled: operations 8 -> 5",
  "files are linked: a namespace of another file [ts]": "bundled: operations 15 -> 11",
  "files are linked: a namespace read by constant names [js]": "bundled: operations 8 -> 5",
  "files are linked: a namespace read by constant names [ts]": "bundled: operations 8 -> 5",
  "files are linked: a namespace read for a name that is not there [js]":
    "bundled: operations 7 -> 5, run-time operations 239 -> 238",
  "files are linked: an enum of another file [ts]":
    "bundled: code bytes 292 -> 106, operations 17 -> 5, run-time operations 242 -> 238",
  "files are linked: an enum of another file decides [ts]":
    "bundled: code bytes 277 -> 105, operations 18 -> 5, run-time operations 241 -> 238",
  "files are linked: an enum through a barrel [ts]":
    "bundled: code bytes 236 -> 96, operations 14 -> 4, run-time operations 241 -> 238",
  "files are linked: an enum through a namespace [ts]":
    "bundled: code bytes 230 -> 100, operations 12 -> 4, run-time operations 241 -> 238",
  "files are linked: an enum whose members name an enum of another file [ts]":
    "each file: run-time operations 245 -> 242; bundled: code bytes 328 -> 208, operations 21 -> 9, run-time operations 245 -> 240",
  "names in brackets, keys and shorthand: a computed key that is a text [ts]":
    "each file: code bytes 215 -> 142, operations 9 -> 7, run-time operations 241 -> 240; bundled: code bytes 215 -> 142, operations 9 -> 7, run-time operations 241 -> 240",
  "names in brackets, keys and shorthand: a quoted key [ts]":
    "each file: code bytes 201 -> 132, operations 9 -> 6, run-time operations 241 -> 240; bundled: code bytes 201 -> 132, operations 9 -> 6, run-time operations 241 -> 240",
  "names in brackets, keys and shorthand: a text in brackets is a name [ts]":
    "each file: code bytes 238 -> 137, operations 11 -> 6, run-time operations 241 -> 240; bundled: code bytes 238 -> 137, operations 11 -> 6, run-time operations 241 -> 240",
  "names in brackets, keys and shorthand: joined texts in brackets [ts]":
    "each file: code bytes 190 -> 128, operations 9 -> 6, run-time operations 241 -> 240; bundled: code bytes 190 -> 128, operations 9 -> 6, run-time operations 241 -> 240",
  "namespaces: a constant of a namespace [ts, two files]":
    "bundled: code bytes 294 -> 115, operations 17 -> 6, run-time operations 241 -> 240",
  "namespaces: a function of a namespace [ts, two files]":
    "each file: operations 22 -> 20; bundled: code bytes 335 -> 293, operations 22 -> 15",
  "namespaces: a namespace in a namespace [ts, two files]": "bundled: operations 17 -> 15",
  "namespaces: a namespace nobody reads [ts, two files]":
    "bundled: code bytes 199 -> 103, operations 10 -> 5, run-time operations 240 -> 239",
  "namespaces: a namespace of types alone [ts, two files]":
    "each file: code bytes 190 -> 128, operations 9 -> 6; bundled: code bytes 190 -> 128, operations 9 -> 6",
  "namespaces: a namespace of types alone [ts]":
    "each file: code bytes 190 -> 128, operations 9 -> 6; bundled: code bytes 190 -> 128, operations 9 -> 6",
  "namespaces: an alias of a member [ts, two files]":
    "bundled: code bytes 224 -> 102, operations 11 -> 5, run-time operations 240 -> 239",
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
  "what only the checker reads: parameter properties [ts]":
    "each file: code bytes 492 -> 207, operations 19 -> 7; bundled: code bytes 492 -> 207, operations 19 -> 7",
};
