# Crashes and hangs of `bun --lint` on the conformance corpus

No sweep ran for this file, and nothing below `src/` was changed for it.

- Binary: 1.4.3-canary.1+be1ebe529, the release build of /workspace/wt/parser, whose src/ is that of 3110ce85cf; its raw runs are those of round2/default-check-classification of 2026-10-01 (probes/raw.ts: every run instance through `<binary> --lint <operands>` as the default check starts it, 4 jobs, limit 60 s).
- Corpus: typescript-go 89d5d5b, TypeScript 5848bc5, laid over a clone of `3110ce85cf9ad3ce21a0396315b5213b2cc8c6df` with `sync.sh`.
- Outcomes: the rules of the default check of that commit (`check_bun_lint.ts` readRun and toCheckResult, `run.ts` compare) applied by `from-release-raw.py` to what each process gave back: exit code, signal, stdout, stderr.
- The scripts and the tables are in `round2/lint-survey/bottom-up/` of these notes (`HOWTO.txt`).

Instances that the reference runs: 12,797. Not laid out on this disk (no process started): 186. Processes of `<binary> --lint <root files>` in the sweep: 12,611.
The sweep reports as died: 0; as not ended within 120 s: 0.

What counts as a crash: the command ended by a signal, with an exit code that is not 0 or 2, wrote to stdout, or wrote a line to stderr that is no diagnostic (a panic, a report of a sanitizer). What counts as a hang: no end within 120 s. A diagnostic of Bun's parser or of a rule is neither: the default check of today calls such a run `crash` as well, with the reason `stderr line n has the code <name>, which is no code of TypeScript`, and those are counted in the survey table of LOG.md, not here.

## Crashes and hangs

Every instance whose outcome in the sweep was crash or timeout, run again with stdout and stderr kept: 0 runs died and 0 did not end within the limit, of 1336 runs; 0 entries.

## For the parser unit: class C instances where Bun reports what TypeScript does not

These are differences, not crashes. The reference (typescript-go at the pinned commit) reports nothing for these 28 instances of 27 cases, and neither project has an error baseline of their names; `bun --lint` prints a diagnostic and ends with 2. A line is as the command printed it: the path is relative to the current directory of the instance, the line and the column are those of the unit (the case file has its directive lines above). The owner and the cause are a reading of the case and of the source, not the result of a fix.

### compiler/continueTarget3.ts

- Instances: `continueTarget3.ts`; root files `/.src/continueTarget3.ts`
- Owner: parser (visit pass, also in `bun run`)
- Cause: `target1: target2: while (true) { continue target1; }` is valid ECMAScript (node runs it). `s_label` (src/js_parser/visit/visit_stmt.rs:1330) sets `label_stmt_is_loop` only when the labelled statement itself is a loop, not when it is a label of a loop, and `s_continue` (:1301) then reports the outer label. The installed bun 1.4.3 refuses the same file when it runs it.

```
continueTarget3.ts(4,3): error syntax: Cannot "continue" to label target1
```

### compiler/declarationEmitClassSetAccessorParamNameInJs2.ts

- Instances: `declarationEmitClassSetAccessorParamNameInJs2.ts`; root files `/.src/foo.js`
- Owner: a rule (no-empty-pattern), not the parser
- Cause: `set bar({}) {}` in a JavaScript root. The report is what ESLint's rule says of the file; it is no difference of the parser. It shows that a rule report fails an instance of class C as long as rule reports are part of the comparison.

```
foo.js(7,13): error no-empty-pattern: Unexpected empty object pattern.
```

### compiler/duplicateVarAndImport.ts

- Instances: `duplicateVarAndImport.ts`; root files `/.src/duplicateVarAndImport.ts`
- Owner: parser
- Cause: `var a; namespace M { } import a = M;`: TypeScript lets the alias of a namespace that is not instantiated merge with the variable. Bun reports the redeclaration, and at (1,1): the message has no line (src/lint/diagnostic.rs from_data puts it at the start of the file).

```
duplicateVarAndImport.ts(1,1): error syntax: "a" has already been declared
```

### compiler/elidedEmbeddedStatementsReplacedWithSemicolon.ts

- Instances: `elidedEmbeddedStatementsReplacedWithSemicolon.ts`; root files `/.src/elidedEmbeddedStatementsReplacedWithSemicolon.ts`
- Owner: parser (also in `bun run`)
- Cause: `if (1) const enum A {}` and seven more: TypeScript parses a `const enum` as the body of `if`, `else`, `while`, `do`, `for`, `for-in`, `for-of` and `with` without a grammar error. Bun: "Cannot use a declaration in a single-statement context" (`forbid_lexical_decl`, src/js_parser/p.rs:4205). The installed bun 1.4.3 refuses the same text when it runs the file.

```
elidedEmbeddedStatementsReplacedWithSemicolon.ts(2,5): error syntax: Cannot use a declaration in a single-statement context
elidedEmbeddedStatementsReplacedWithSemicolon.ts(4,5): error syntax: Cannot use a declaration in a single-statement context
elidedEmbeddedStatementsReplacedWithSemicolon.ts(7,5): error syntax: Cannot use a declaration in a single-statement context
elidedEmbeddedStatementsReplacedWithSemicolon.ts(11,5): error syntax: Cannot use a declaration in a single-statement context
elidedEmbeddedStatementsReplacedWithSemicolon.ts(14,5): error syntax: Cannot use a declaration in a single-statement context
elidedEmbeddedStatementsReplacedWithSemicolon.ts(17,5): error syntax: Cannot use a declaration in a single-statement context
elidedEmbeddedStatementsReplacedWithSemicolon.ts(20,5): error syntax: Cannot use a declaration in a single-statement context
elidedEmbeddedStatementsReplacedWithSemicolon.ts(24,5): error syntax: Cannot use a declaration in a single-statement context
```

### compiler/fileWithNextLine2.ts

- Instances: `fileWithNextLine2.ts`; root files `/.src/fileWithNextLine2.ts`
- Owner: lexer
- Cause: U+0085 (NEL) between tokens. TypeScript's scanner takes it as white space; ECMAScript does not (it is no WhiteSpace and no LineTerminator), and Bun follows ECMAScript: "Unexpected" followed by the character.

```
fileWithNextLine2.ts(3,8): error syntax: Unexpected 
```

### compiler/isolatedModulesSketchyAliasLocalMerge.ts

- Instances: `isolatedModulesSketchyAliasLocalMerge(isolatedmodules=false,verbatimmodulesyntax=false).ts`; root files `/.src/types.ts` `/.src/bad.ts` `/.src/good.ts`
- Owner: parser (needs the checker)
- Cause: bad.ts: `import { FC } from "./types"; let FC: FC | null = null;` where types.ts exports only a type FC. TypeScript merges the imported type with the local value; one file alone cannot know that FC is a type. Only the variation isolatedmodules=false,verbatimmodulesyntax=false is of class C. The error is logged by src/js_parser/scan/scan_imports.rs:348.

```
bad.ts(2,5): error syntax: "FC" has already been declared
```

### compiler/sourceMap-LineBreaks.ts

- Instances: `sourceMap-LineBreaks(target=es2015).ts`; root files `/.src/sourceMap-LineBreaks.ts`
- Owner: lexer
- Cause: The same as compiler/fileWithNextLine2.ts: U+0085 after `var endsWithNextLine = 1;`.

```
sourceMap-LineBreaks.ts(3,26): error syntax: Unexpected 
```

### compiler/strictModeEnumMemberNameReserved.ts

- Instances: `strictModeEnumMemberNameReserved.ts`; root files `/.src/strictModeEnumMemberNameReserved.ts`
- Owner: parser (also in `bun run`)
- Cause: `"use strict"; enum E { static }`: the name of an enum member is a property name, and TypeScript accepts a reserved word there. Bun declares the member as a symbol of the scope of the enum, and `declare_symbol` (src/js_parser/p.rs:5203) applies the strict-mode check of a binding name to it. The installed bun 1.4.3 refuses the same text when it runs the file.

```
strictModeEnumMemberNameReserved.ts(3,5): error syntax: "static" is a reserved word and cannot be used in strict mode
```

### compiler/symbolMergeValueAndImportedType.ts

- Instances: `symbolMergeValueAndImportedType.ts`; root files `/.src/main.ts` `/.src/other.ts`
- Owner: parser (needs the checker)
- Cause: main.ts: `import { X } from "./other"; const X = 42;` where other.ts has `export type X = {}`. As above.

```
main.ts(2,7): error syntax: "X" has already been declared
```

### compiler/usedImportNotElidedInJs.ts

- Instances: `usedImportNotElidedInJs.ts`; root files `/.src/test.js`
- Owner: parser (ECMAScript is stricter than TypeScript here)
- Cause: test.js: `import * as moment from 'moment'; ... export const moment = ...`: a redeclaration that ECMAScript rejects. typescript-go reports nothing for this JavaScript file.

```
test.js(3,14): error syntax: "moment" has already been declared
```

### conformance/async/es2017/asyncArrowFunction/asyncArrowFunction2_es2017.ts

- Instances: `asyncArrowFunction2_es2017.ts`; root files `/.src/asyncArrowFunction2_es2017.ts`
- Owner: parser and the command (a script is parsed as a module; also in `bun run`)
- Cause: `var f = (await) => { }` in a file without import or export: a script for TypeScript and for ECMAScript, where `await` is an identifier. The lint parse sets `top_level_await` (src/runtime/cli/lint_command.rs:230), as every parse of Bun does, and the parser then takes `await` as the keyword. The installed bun 1.4.3 refuses the same file when it runs it; node runs it.

```
asyncArrowFunction2_es2017.ts(1,15): error syntax: Unexpected )
```

### conformance/async/es2017/asyncArrowFunction/asyncArrowFunction4_es2017.ts

- Instances: `asyncArrowFunction4_es2017.ts`; root files `/.src/asyncArrowFunction4_es2017.ts`
- Owner: parser and the command (a script is parsed as a module; also in `bun run`)
- Cause: `var await = () => { }` in a script: "Cannot use "yield" or "await" here." (src/js_parser/parse/mod.rs:1645). As asyncArrowFunction2_es2017.ts; node runs the file.

```
asyncArrowFunction4_es2017.ts(1,5): error syntax: Cannot use "yield" or "await" here.
```

### conformance/async/es5/asyncArrowFunction/asyncArrowFunction2_es5.ts

- Instances: `asyncArrowFunction2_es5(target=es2015).ts`; root files `/.src/asyncArrowFunction2_es5.ts`
- Owner: parser and the command (a script is parsed as a module; also in `bun run`)
- Cause: The same as asyncArrowFunction2_es2017.ts.

```
asyncArrowFunction2_es5.ts(1,15): error syntax: Unexpected )
```

### conformance/async/es5/asyncArrowFunction/asyncArrowFunction4_es5.ts

- Instances: `asyncArrowFunction4_es5(target=es2015).ts`; root files `/.src/asyncArrowFunction4_es5.ts`
- Owner: parser and the command (a script is parsed as a module; also in `bun run`)
- Cause: The same as asyncArrowFunction4_es2017.ts.

```
asyncArrowFunction4_es5.ts(1,5): error syntax: Cannot use "yield" or "await" here.
```

### conformance/async/es6/asyncArrowFunction/asyncArrowFunction2_es6.ts

- Instances: `asyncArrowFunction2_es6.ts`; root files `/.src/asyncArrowFunction2_es6.ts`
- Owner: parser and the command (a script is parsed as a module; also in `bun run`)
- Cause: The same as asyncArrowFunction2_es2017.ts.

```
asyncArrowFunction2_es6.ts(1,15): error syntax: Unexpected )
```

### conformance/async/es6/asyncArrowFunction/asyncArrowFunction4_es6.ts

- Instances: `asyncArrowFunction4_es6.ts`; root files `/.src/asyncArrowFunction4_es6.ts`
- Owner: parser and the command (a script is parsed as a module; also in `bun run`)
- Cause: The same as asyncArrowFunction4_es2017.ts.

```
asyncArrowFunction4_es6.ts(1,5): error syntax: Cannot use "yield" or "await" here.
```

### conformance/async/es6/asyncWithVarShadowing_es6.ts

- Instances: `asyncWithVarShadowing_es6.ts`; root files `/.src/asyncWithVarShadowing_es6.ts`
- Owner: parser (ECMAScript is stricter than TypeScript here)
- Cause: `catch ({ x }) { var x; }`: ECMAScript forbids a `var` of a name that a destructuring catch parameter binds; TypeScript reports nothing. The message has no quotes (src/js_parser/p.rs:3809).

```
asyncWithVarShadowing_es6.ts(130,14): error syntax: x has already been declared
```

### conformance/externalModules/typeOnly/namespaceImportTypeQuery2.ts

- Instances: `namespaceImportTypeQuery2.ts`; root files `/z.ts` `/a.ts` `/b.ts`
- Owner: parser (needs the checker)
- Cause: /a.ts: `import { A } from './z'; const A = 0;` where z.ts has `export type { A }`. As above.

```
../a.ts(2,7): error syntax: "A" has already been declared
```

### conformance/externalModules/typeOnlyMerge1.ts

- Instances: `typeOnlyMerge1.ts`; root files `/.src/a.ts` `/.src/b.ts` `/.src/c.ts`
- Owner: parser (needs the checker)
- Cause: b.ts: `import { A } from "./a"; const A = 0;` where a.ts has `export type { A }`. As above.

```
b.ts(2,7): error syntax: "A" has already been declared
```

### conformance/importDefer/dynamicImportDefer.ts

- Instances: `dynamicImportDefer(module=esnext).ts`, `dynamicImportDefer(module=preserve).ts`; root files `/.src/a.ts` `/.src/b.ts`
- Owner: parser (syntax that Bun does not have)
- Cause: b.ts: `import.defer("./a.js")`. After `import.` Bun's parser knows `meta` alone (src/js_parser/parse/parse_import_export.rs:23). Two instances: module=esnext and module=preserve.

```
b.ts(1,8): error syntax: Expected "meta" but found "defer"
b.ts(3,3): error syntax: Expected ")" but found ";"
```

### conformance/nonjsExtensions/declarationFileForHtmlFileWithinDeclarationFile.ts

- Instances: `declarationFileForHtmlFileWithinDeclarationFile.ts`; root files `/.src/component.d.html.ts` `/.src/file.d.ts` `/.src/main.ts`
- Owner: the command
- Cause: component.d.html.ts is a declaration file for TypeScript: tspath.GetDeclarationFileExtension (internal/tspath/extension.go:121) takes a base name that ends in .ts and holds ".d.". `is_declaration_file` (src/runtime/cli/lint_command.rs:147) tests the three suffixes .d.ts, .d.mts and .d.cts, so the file is parsed as a module and `export const blogPost: Element;` has no initializer.

```
component.d.html.ts(8,14): error syntax: The constant "blogPost" must be initialized
```

### conformance/nonjsExtensions/declarationFileForHtmlImport.ts

- Instances: `declarationFileForHtmlImport(allowarbitraryextensions=true).ts`; root files `/.src/component.d.html.ts` `/.src/file.ts`
- Owner: the command
- Cause: The same as declarationFileForHtmlFileWithinDeclarationFile.ts, in the variation allowarbitraryextensions=true.

```
component.d.html.ts(8,14): error syntax: The constant "blogPost" must be initialized
```

### conformance/parser/ecmascript5/EnumDeclarations/parserInterfaceKeywordInEnum1.ts

- Instances: `parserInterfaceKeywordInEnum1.ts`; root files `/.src/parserInterfaceKeywordInEnum1.ts`
- Owner: parser (also in `bun run`)
- Cause: `"use strict"; enum Bar { interface, }`: the same as compiler/strictModeEnumMemberNameReserved.ts.

```
parserInterfaceKeywordInEnum1.ts(4,5): error syntax: "interface" is a reserved word and cannot be used in strict mode
```

### conformance/parser/ecmascript5/Statements/ContinueStatements/parser_continueTarget3.ts

- Instances: `parser_continueTarget3.ts`; root files `/.src/parser_continueTarget3.ts`
- Owner: parser (visit pass, also in `bun run`)
- Cause: The same as compiler/continueTarget3.ts.

```
parser_continueTarget3.ts(4,3): error syntax: Cannot "continue" to label target1
```

### conformance/salsa/plainJSRedeclare3.ts

- Instances: `plainJSRedeclare3.ts`; root files `/.src/plainJSRedeclare.js`
- Owner: parser (ECMAScript is stricter than TypeScript here)
- Cause: plainJSRedeclare.js with checkJs false: `const orbitol = 1` then `var orbitol = 1 + false`. ECMAScript rejects it; typescript-go reports nothing at these settings.

```
plainJSRedeclare.js(2,5): error syntax: "orbitol" has already been declared
```

### conformance/salsa/privateIdentifierExpando.ts

- Instances: `privateIdentifierExpando.ts`; root files `/.src/privateIdentifierExpando.js`
- Owner: parser (ECMAScript is stricter than TypeScript here)
- Cause: privateIdentifierExpando.js: `x.#bar.baz = 20;` outside a class. ECMAScript rejects it; typescript-go has no error baseline for the instance.

```
privateIdentifierExpando.js(2,3): error syntax: Expected identifier but found "#bar"
privateIdentifierExpando.js(2,8): error syntax: Expected ";" but found "baz"
privateIdentifierExpando.js(2,12): error syntax: Unexpected =
```

### conformance/types/conditional/inferTypesWithExtends1.ts

- Instances: `inferTypesWithExtends1.ts`; root files `/.src/inferTypesWithExtends1.ts`
- Owner: parser (type grammar) (also in `bun run`)
- Cause: `type X14<T> = T extends keyof infer U extends number ? 1 : 0;` and `{ [P in infer U extends keyof T ? 1 : 0]: 1; }`: where TypeScript has to decide whether `extends` after `infer U` is the constraint of the infer type or the start of a conditional type, Bun's type parser takes the other reading and then misses the `?`. The installed bun 1.4.3 refuses the same text when it runs the file.

```
inferTypesWithExtends1.ts(102,61): error syntax: Expected "?" but found ";"
inferTypesWithExtends1.ts(103,6): error syntax: Expected ":" but found "X15"
inferTypesWithExtends1.ts(103,13): error syntax: Expected "(" but found "="
inferTypesWithExtends1.ts(103,79): error syntax: Expected ")" but found ";"
```
