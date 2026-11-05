// The lint of the rule "decide by binding and by flow, never by text". It finds, in the engine's C++ and in the front end's Rust, each line that compares the text
// of a name of the program with a literal: an identifier, a property, a module specifier, any string out of the syntax tree or the IR.
// `name == "eval"` says yes to a local that somebody called eval, and no to `const e = eval`. The question to ask is about a thing: this binding, this object, this cell.
//
// It reads tokens and knows no types, so it goes by what the compared expression is called:
// - A literal is a string or a character, but not the empty string, or a constant of the same file that holds one.
// - A constant that stands for a text is that text: `known::eval` in Rust, `BuiltinNames::eval` in C++, a list of such. `name == known::eval` asks what `name == "eval"` asks.
//   All but `keysOfLanguage`, which the language reads off whatever object it is handed, and `namesOfBinder`, which no program can write.
// - An expression is the text of a name where one of its words has a part out of `partsOfNames`, reads the table of strings, or was set from such an expression in the same block.
// - What stands in `Ident(..)`, `Name(..)` or `keyOf(..)` is held against a name, whatever the other side is called.
// - The id of a thing (BuiltinId, RuntimeModule, SymbolId, the key of one cell held against the key of another) has no literal beside it. Comparing those is what the rule asks for, and is never reported.
// - A finding is reported on the line of the literal: for `match` and `switch`, on the line of each arm that has one.
// It cannot see whether a thing stands in front of a name. Where one does, an entry of `allowed` names the file, the names and the thing.
// A lint that finds nothing proves nothing: names-compared-as-text-control.txt has every pattern once.
//
//   bun test/aot/compiler/names-compared-as-text.ts [folder..]    each finding: file:line and the line. A folder stands in place of aot/ or src/aot/, one of `load` for itself
//   bun test/aot/compiler/names-compared-as-text.ts --allowed     what each entry of `allowed` covers today
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export type Language = "C++" | "Rust";
/** `load`: folders outside src/aot, each under the path that `allowed` writes for it: `{ "src/sema/fold/": "/checkout/src/sema/fold" }`. */
export type Roots = { engine?: string; frontEnd?: string; load?: Record<string, string> };

export class Finding {
  constructor(
    readonly file: string,
    readonly line: number,
    readonly text: string,
    readonly pattern: string,
    readonly subject: string,
  ) {}
  toString() {
    return `${this.file}:${this.line}: ${this.text}`;
  }
}

const repository = resolve(import.meta.dir, "../../..");

/**
 * The engine's sources are looked for as ../engine/testaot.ts looks for the engine's tests: beside this Bun, where CI packs them as the folder `aot-sources`,
 * which is laid out as `aot` is, then in a checkout. Without either there is no `engine`.
 */
export const rootsOfThisCheckout: Roots = {
  engine: [
    join(dirname(process.execPath), "aot-sources"),
    ...[process.env.BUN_WEBKIT_PATH, join(repository, "vendor", "WebKit")]
      .filter(path => path !== undefined)
      .map(path => join(path, "Source", "JavaScriptCore", "aot")),
  ].find(path => existsSync(path)),
  frontEnd: join(repository, "src", "aot"),
  // Which files a build takes in, what it folds and what it asks the checker is decided outside src/aot.
  load: Object.fromEntries(
    ["src/sema/file_analysis", "src/sema/import_sites", "src/sema/fold", "src/sema/check/aot", "src/bundler/aot"].map(
      folder => [`${folder}/`, join(repository, folder)],
    ),
  ),
};

/**
 * Where text may be compared with a literal. A path begins with `aot/` in the engine and with `src/` in Bun. With `lines`, only such lines of the file are allowed.
 * The first two are TypeScript, which the lint does not read: they stand here so that all of "the tables of built-ins" is in one list.
 * The engine's two places that may compare a name at all (a read off `unknown`, a layout guessed from the names read off a parameter) have no entry: they hold one key of the program against another.
 * "A name is compared in two places only, and both have a thing in front of the name": an entry for such a place says which thing.
 */
export const allowed: { paths: RegExp; lines?: RegExp; reason: string }[] = [
  { paths: /^aot\/builtins\/[^/]+\.builtins\.ts$/, reason: "the tables of built-ins as they are written" },
  { paths: /^aot\/builtins\/generator\/|^src\/codegen\/builtins\//, reason: "the generators of those tables" },
  { paths: /(^|\/)generated\.rs$/, reason: "holds nothing but the include of generated tables" },
  {
    paths: /^src\/aot\/builtins\/table(\.rs$|\/)/,
    reason: "the table of built-ins: the one place where the text of a name, a module or a directive becomes an id",
  },
  { paths: /^aot\/builtins\/AOTBuiltin(Table\w*|NameSlots)\.(h|cpp)$/, reason: "the same table in the engine" },
  {
    paths: /^aot\/ir\/AOTNameClass\.(h|cpp)$|^src\/aot\/ir\/name_class\.rs$/,
    reason:
      "the class of a name (an index, a number as JavaScript prints it, a word that the schema lists) is read off its text once",
  },
  {
    paths: /^aot\/driver\/AOTOptionWords\.(h|cpp)$|^src\/aot\/options\.rs$/,
    reason: "option words are the build's own, not the program's",
  },
  {
    paths: /^src\/aot\/load\/test_runner_names\.rs$/,
    reason: "a name that begins with % is the build's own: no program can write one",
  },
  {
    paths: /^src\/aot\/(load\/react_compiler\/module_items|lower\/quoted_text)\.rs$/,
    lines: /\.strip_prefix\(NAME_PREFIX\)|\.starts_with\(b"%"\)/,
    reason: "an identifier that begins with % is the build's own too: what is asked is who made the variable",
  },
  {
    paths:
      /^src\/aot\/load\/(contents\/(entry_points|load_names|worker_entries)|data_modules|disk_delegation|externals|host|loaders|manual_mocks|module_paths|plugin_modules|project|runtime_\w+|source_provider|sources)(\.rs$|\/)|^src\/aot\/compile\/(load_stage|paths)\.rs$|^src\/aot\/(load\/contents|module_keys|modules\/requests)\.rs$/,
    reason: "Load: what a file extension or a module specifier loads is a question about a path",
  },
  {
    paths: /^src\/aot\/(compile\/program_reach|modules\/spelled_files)\.rs$/,
    lines: /b"(?:\.{0,2}\/|\/index)"|b'@'/,
    reason:
      "a string of the program that begins like a relative path may spell a file that the program loads, and the path of a file tells its package and whether it is the index of its folder",
  },
  {
    paths: /^src\/aot\/lower\/module\/loads\.rs$/,
    lines: /\.strip_prefix\(b"(?:\.|\/\.\.)"\)/,
    reason:
      'the path that the build has made of `path.join(__dirname, "..", "a.js")` begins with its steps up: they are pieces of a path, and a path is bound to nothing',
  },
  {
    paths: /^src\/aot\/lower\/module\/loads\.rs$/,
    lines: /match bytes\.ends_with\(b"\/"\)/,
    reason:
      "whether the base that is written for createRequire() ends as a folder: the last byte of a path, and a path is bound to nothing",
  },
  {
    paths: /^src\/aot\/lower\/module\/loads\.rs$/,
    lines: /!name\.starts_with\(b"node:"\)/,
    reason:
      "the scheme in the name of a built-in module, which the table of built-ins has found by then: how a transpiler prints that name is a question about a path",
  },
  {
    paths: /^src\/aot\/compile\/removable\.rs$/,
    lines: /== b"u";/,
    reason:
      '`typeof a < "u"`, as minifiers write `typeof a !== "undefined"`: the value of a string that the answer of `typeof` is compared with. A value is no name',
  },
  {
    paths: /^src\/aot\/lower\/jsx\/element\.rs$/,
    lines: /let \[quote @ \(b'"' \| b'\\''\)/,
    reason:
      "the first word of a JSX pragma that stands in quotes is a string, as Bun's transpiler prints it: no name begins with a quote",
  },
  {
    paths: /^src\/aot\/(compile\/)?module_list\.rs$/,
    reason: "the list of modules writes the specifier of a built-in module as the bundler writes it",
  },
  {
    paths: /^aot\/runtime\/AOT(Module\w*|BuiltinModules)\.(h|cpp)$/,
    reason: "the specifiers and paths that a running program hands to import() and require()",
  },
  {
    paths: /^aot\/ir\/AOTIRProgram\.cpp$|^aot\/facts\/AOTFlowRules(LoadsByName|Modules)\.cpp$/,
    lines: /'[?.@\/#:]'|'\\\\'|"(?:bun|node:|bun:|bun:test)"_span/,
    reason:
      "what the specifier or the path of a module stands for is a question about a path: its scheme, its query, its steps and its package",
  },
  {
    paths: /^aot\/runtime\/AOTJSON(ParseOperations\.cpp|Scanner\.h)$/,
    lines: /[=!]= '(?:[^'\\]|\\.)'/,
    reason:
      "the marks of a JSON text that a running program parses: a bracket, a comma, a colon, a quote, the first letter of a literal",
  },
  {
    paths:
      /^aot\/builtins\/AOT(BufferBuiltinOperations|BuiltinCallEmitter)\.cpp$|^aot\/walk\/AOTInlineBuiltinFormsOfPrimitives\.cpp$/,
    lines: /"(?:utf8|utf-8|ascii|latin1|binary)"_s/,
    reason:
      "the value of a string that tells a function of Buffer its encoding: an operand of a call. A value is no name",
  },
  {
    paths: /^aot\/facts\/AOTFlowRulesBehaviors\.cpp$/,
    lines: /static_cast<uint8_t>\('%'\)/,
    reason: "the value of a string that console.log may take for a format. A value is no name",
  },
  {
    paths: /^aot\/builtins\/AOT(FormatPatternPlanner|IntlBuiltinOperations)\.cpp$/,
    lines: /"timeZone"_s/,
    reason: "the key of an option in the list that the build has written for a formatter of Intl",
  },
  {
    paths: /^aot\/ir\/AOTTypeTextParser\.(h|cpp)$/,
    reason:
      "the words of the text form of a type, which tests and tools write: the language of the IR, not the program's",
  },
  {
    paths: /^aot\/facts\/AOTFlowRuleTable\.cpp$/,
    lines: /name\.find\('\.'\)/,
    reason: "the name of a rule of the flow as the text forms print it: the family, a dot, the name in the family",
  },
  {
    paths: /^aot\/facts\/AOT(Facts|FlowGraphText|SummaryText)\.cpp$/,
    lines: /byte == '(?:"|\\\\|\\n)'/,
    reason: "a printer of a text form escapes a quote, a backslash and a line break in whatever string it prints",
  },
  {
    paths: /^aot\/runtime\/AOTMembersLeftOut\.cpp$/,
    lines: /startsWith\("get "_s\)|endsWith\('\.'\)/,
    reason:
      "the language names a getter `get ` and its key, and a sentence is added to a message behind its full stop: wording, while the program runs",
  },
  {
    paths: /^src\/aot\/(report|diagnostics|package_diagnostics)(\.rs$|\/)|^src\/aot\/diagnostic_codes\.rs$/,
    reason: "the wording of diagnostics",
  },
  {
    paths:
      /^aot\/(support\/AOTDiagnostics|walk\/AOTWalkNotes|driver\/AOT(ExplainRecords|ResultSections|CodeReports)|runtime\/AOT(ErrorMessages|StackTrace|RuntimeReporter))\.(h|cpp)$/,
    reason: "the wording of diagnostics, error messages and stack traces",
  },
  {
    paths: /^src\/sema\/(import_sites|fold)\//,
    lines: /\bspecifier\b|^b"(?:fs|fs\/promises|bun)"(?: \| b"node:fs(?:\/promises)?")? => Holder::/,
    reason:
      "the specifier in the record of an import, or in a `require` that the binder has answered for: which module it names is a question about a path",
  },
  {
    paths: /^src\/sema\/import_sites\/(alternatives|call_sites|changed_files)\.rs$/,
    lines: /b"(?:\.{1,2}\/?|\/)"/,
    reason:
      "the name that a loader, a resolver or the file system is handed is a path, and its steps are bound to nothing",
  },
  {
    paths:
      /^src\/sema\/(import_sites\/(alternatives|call_sites|made_requires)|fold\/(folder_names|known_to_bun_run|removed_by_bun_run|string_affixes))\.rs$/,
    lines:
      /known::(?:require|resolve|getBuiltinModule|process|Module|call|apply|url|href|path|main|hot|join|meta_\w+)\b|b"(?:_?cache|sep|cwd|posix|normalize|platform|arch|fileURLToPath|pathToFileURL)"/,
    reason:
      "a member behind a thing: of `import.meta`, which is syntax; of `require`, `module` and `process`, where the binder has said that the object is the module's own parameter or the global; of what node:module, node:path, node:url, node:os and node:process export, found by the record of the import",
  },
  {
    paths: /^src\/sema\/(import_sites\/alternatives|fold\/folder_calls)\.rs$/,
    lines:
      /known::charCodeAt\b|b"(?:forEach|map|filter|find|findLast|findIndex|findLastIndex|some|every|includes|indexOf|lastIndexOf|has|add|size|keys|values|join|href|pathname|length|default|toString|valueOf|toJSON|trim|trimStart|trimEnd|toLowerCase|toUpperCase|concat|replace|replaceAll|slice|substring)"|known::(?:join|push)\b/,
    reason:
      "a member behind a value: whoever follows a text has the list, the Set that `new Set(..)` of the free name made, the text, the URL, the object literal or the global `Object` in hand where it reads the name of the member, and built-ins are frozen",
  },
  {
    paths: /^src\/sema\/import_sites\/alternatives\.rs$/,
    lines:
      /^(?:\| )?b"(?:__defineGetter__|__defineSetter__|__lookupGetter__|__lookupSetter__|__proto__|constructor|hasOwnProperty|isPrototypeOf|propertyIsEnumerable|toLocaleString)"$/,
    reason:
      "a table of built-ins: what every object inherits from `Object.prototype`, asked of a key that an object literal does not write",
  },
  {
    paths: /^src\/sema\/import_sites\/changed_files\.rs$/,
    lines:
      /b"(?:writeFile|appendFile|truncate|unlink|createWriteStream|rm|copyFile|link|symlink|cp|rename|open)(?:Sync)?"|b"(?:promises|file|write|writer|delete|recursive)"/,
    reason:
      "a table of built-ins: which functions of node:fs, node:fs/promises, `Bun` and `Bun.file()` change a file, and which operand names it. find_function() finds the holder first, by the record of the import or as the free name `Bun`",
  },
  {
    paths: /^src\/sema\/import_sites\/call_sites\.rs$/,
    lines:
      /known::(?:module|mock|doMock|unmock|doUnmock|dontMock|importActual|importMock)\b|^if requires\.contains\(&name\)/,
    reason:
      "a member of `mock`, `jest` or `vi`, which may_be_export_of_test_runner() finds by the record of the import from the test runner, and of the parameter that the binder finds for `build.module()`",
  },
  {
    paths: /^src\/sema\/import_sites\/call_sites\.rs$/,
    lines: /known::(?:toMatchInlineSnapshot|setup)\b/,
    reason:
      "left by text: Bun's transpiler keeps the frame of whoever calls a member `toMatchInlineSnapshot`, whatever the object is, and a build does as it does; and nobody follows an object literal with the key `setup` to `Bun.plugin`, which only takes a module in",
  },
  {
    paths: /^src\/sema\/import_sites\/call_sites\.rs$/,
    lines: /name == known::Worker\b/,
    reason:
      "`Worker` behind the global object, and a read off `unknown` (section 8): a constructor that neither the binder nor the record of an import leads to may be the platform's, so its name counts, which only takes more in",
  },
  {
    paths: /^src\/sema\/import_sites\/import_uses\.rs$/,
    lines: /ExprKind::Ident\(name\) if name == known::eval\b/,
    reason:
      "the language makes a call a direct eval by the identifier `eval` as it is written, whatever it is bound to: a file that spells it is taken to read each of its imports",
  },
  {
    paths: /^src\/sema\/import_sites\/jsx\.rs$/,
    lines: /PropKey::Name\(known::key\)/,
    reason: "the attribute `key` of a JSX element: the transform of JSX goes by that word",
  },
  {
    paths: /^src\/sema\/fold\/folder_calls\.rs$/,
    lines: /^b"[\^$]" => \[|\.starts_with\(b"data:"\)/,
    reason:
      "the text of a regular expression and the scheme of a URL are values. Appendix D, Workers: \"Code in a `data:` URL that the program writes out is an entry point too\"",
  },
  {
    paths:
      /^src\/sema\/fold\/folder_(names|operators)\.rs$|^src\/aot\/(builtins\/resolve\/module_objects|known_helpers\/(canonical|quiet)|load\/hoisted_mocks|lower\/expression\/global_path)\.rs$/,
    lines: /known::(?:undefined|RegExp|ShadowRealm)\b|\bconstant_globals\.contains\(&name\)/,
    reason:
      "a global by its name, where the binder has said that the identifier is free: Binding::Free stands beside the name or in front of the call",
  },
  {
    paths: /^src\/sema\/fold\/known_constructors\.rs$/,
    lines:
      /^(?:\(|\| )?b"(?:Object|Array|Set|Map|WeakSet|WeakMap|Date|Headers|Response|TextEncoder|TextDecoder)"/,
    reason:
      "a global by its name, where the binder has said that the identifier is free: find_known_construction() returns in front of the list unless Binding::Free stands. The list is the one of Bun's transpiler (KnownGlobal::minify_global_constructor), which goes by the name of an unbound symbol, and a build says what the transpiler does",
  },
  {
    paths: /^src\/sema\/check\/aot\/early_errors\//,
    reason:
      "an early error is a rule of the language about a word as it is written: `let let`, `eval = 1` in strict code, a parameter `this` of an arrow function, an enum member that begins with a digit",
  },
  {
    paths: /^src\/sema\/check\/aot\/(constructor_evidence|prototype_links)\.rs$/,
    lines: /known::(?:call|apply|bind)\b/,
    reason:
      "a read off `unknown` (section 8): whatever is called through a member `call`, `apply` or `bind` may be handed a receiver, so what was gathered of that value is withdrawn: the match only takes an answer away",
  },
  {
    paths: /^src\/aot\/load\/(hoisted_mocks|asked_by_test_runner)\.rs$/,
    lines: /known::(?:vi|vitest|jest|mock|unmock|doMock|doUnmock)\b/,
    reason:
      "an export of the test runner and a member of it: find_api() finds the object by the symbol of its import or as a free name, as plain Bun's hoist_test_mocks.rs does, and the specifier stands in the record of the import",
  },
  {
    paths:
      /^src\/aot\/(builtins\/resolve\/module_objects|load\/loader_aliases|lower\/commonjs\/exports|modules\/(referents|wrapped))\.rs$/,
    lines: /known::(?:require|exports)\b/,
    reason:
      "`import.meta.require` and `module.exports`: `import.meta` is syntax, and the binder has said that the object is the parameter of the module",
  },
  {
    paths: /^src\/aot\/load\/made_own_require\.rs$/,
    lines: /known::(?:node_module|module|createRequire|resolve|main)\b/,
    reason:
      "the specifier in a call of the file's own `require`, `createRequire` of what that call answers, and `resolve` and `main` of that `require`: the binder has said that the callee or the object is the parameter of the module",
  },
  {
    paths: /^src\/aot\/lower\/commonjs\/variables\.rs$/,
    lines: /known::(?:meta_dir|meta_dirname|path|meta_filename|url)\b/,
    reason: "a member of `import.meta`, which is syntax",
  },
  {
    paths: /^src\/aot\/lower\/function\/text_replaced_by_bundling\.rs$/,
    lines: /is_callee && name == known::eval\b/,
    reason:
      "the language makes a call a direct eval by the identifier `eval` as it is written, whatever it is bound to: a bundler that puts something else in its place would change what the call sees",
  },
  {
    paths: /^src\/aot\/lower\/known_call\.rs$/,
    lines: /atoms\.lookup\(b"key"\)/,
    reason:
      "a key of the descriptor that a helper of a compiler is handed: the helper, found by its definition, stands in front of it and reads that key off whatever it gets",
  },
  {
    paths: /^src\/aot\/lower\/call\/written_operands\.rs$/,
    lines: /== b"prototype"/,
    reason:
      "a read off `unknown` (section 8): `Object.create(x.prototype)`, whatever `x` is, is left to the form that every call has: the match only takes an answer away",
  },
  {
    paths: /^src\/aot\/(modules\/imports|test_run_loads\/changed_on_disk|test_runs\/mod)\.rs$/,
    lines: /\[b'\.' \| b'\/', \.\.\]|\[b'\/', \.\.\]|contains_char\(atoms\.bytes\(text\), b'\?'\)/,
    reason: "whether a specifier is a relative path, an absolute one or has a query is a question about a path",
  },
  {
    paths: /^src\/aot\/test_runs\/files_of_run\.rs$/,
    lines: /^b"(?:main|dependencies)" \||\.starts_with\(b"[@.]"\)/,
    reason:
      "the keys of a package.json, the scope in the name of a package and the names of folders on the disk: data that a test run reads to find its files, no name of the program",
  },
  {
    paths: /^src\/aot\/test_runs\/texts\.rs$/,
    lines: /^b"@jest\/globals" \| b"vitest" =>/,
    reason: "the specifier in the record of an import: which module it names is a question about a path",
  },
  {
    paths: /^src\/aot\/test_runs\/texts\.rs$/,
    lines: /tree\.text_of\(name\) == b"length"/,
    reason: "a member behind a value: whoever follows a text has the text in hand where it reads the name of the member",
  },
  {
    paths: /^src\/aot\/test_run_loads\/keys_of_cache\.rs$/,
    lines: /atoms\.bytes\(method\) == b"startsWith"/,
    reason:
      "`if (key.startsWith(folder)) delete require.cache[key]`: a member behind the value that is the key of the table of loaded modules. A key that is no text and answers for itself makes the guess wrong, and a wrong guess is loud: to take out a file that the build has bound for good throws",
  },
  {
    paths: /^src\/sema\/check\/aot\/inferred_from_use\.rs$/,
    lines: /^b"__proto__" \| b"Infinity" \| b"NaN" \|/,
    reason: "the class of a name, read off its text: which keys of a literal a layout lists",
  },
  {
    paths: /^src\/aot\/lower\/condition\.rs$/,
    lines: /name == known::function\b/,
    reason: "an answer of `typeof` that a `switch` writes out: the value of a string. A value is no name",
  },
  {
    paths: /^src\/aot\/lower\/member\.rs$/,
    lines: /known::(?:arguments|caller)\b/,
    reason:
      "`f.arguments` and `f.caller`: the checker is asked next whether the object is a function, and all that follows is a warning",
  },
  {
    paths: /^aot\/facts\/AOTFactsRegExpTexts\.cpp$/,
    lines: /name == "default"_s/,
    reason:
      "`default` in the record of what the loader fills out of a CommonJS module: the record stands in front of the name. The rehearsal only lists the texts for which a matcher is made ahead: a wrong guess costs code and never an answer",
  },
  {
    paths: /^aot\/facts\/AOTLinkCalls\.cpp$/,
    lines: /questions\.keys\.contains\(m_program\.keyOf\(BuiltinNames::toLocaleString\)\)/,
    reason:
      "a table of built-ins: what the functions of Object.prototype ask in turn (object.builtins.ts): toLocaleString() calls `toString`. The list holds what a built-in asks of its operand, and the built-in stands in front of it",
  },
  {
    paths: /^aot\/walk\/AOTWalkArguments\.cpp$/,
    lines: /BuiltinNames::callee\b/,
    reason: "`arguments.callee`: the allocation of the arguments object stands in front of the name",
  },
  {
    paths: /^aot\/walk\/AOTWalkTypedAccesses\.cpp$/,
    lines: /key == program\.keyOf\(BuiltinNames::arguments\) \|\| key == program\.keyOf\(BuiltinNames::caller\)/,
    reason:
      "`F.arguments`, `F.caller`: the one constructor function of the program that the type of the object names stands in front of the name. The engine answers these two for every function itself, so no member of the class is read there",
  },
];

/** Why the whole file is allowed, or, given a line of it, why that line is. */
export const reasonToAllow = (path: string, line?: string) =>
  allowed.find(({ paths, lines }) => paths.test(path) && (!lines || (line !== undefined && lines.test(line))))?.reason;

const languageOf = (path: string): Language | undefined =>
  /\.(h|cpp)$/.test(path) ? "C++" : path.endsWith(".rs") ? "Rust" : undefined;
const folderOf: Record<Language, string> = { "C++": "aot/", Rust: "src/aot/" };
const isTest = (path: string) =>
  /^aot\/tests\/|^src\/(?:.*\/)?(?:(?:source_)?tests?|testing)(?:\.rs$|\/)|_tests?\.rs$/.test(path);

const partsOfNames =
  /^(?:names?|ident(?:ifier)?s?|symbols?|atoms?|keys?|propert(?:y|ies)|props?|members?|specifiers?|uid|spellings?|strings)$/;
// `file_name`, `optionName`: what has such a name is no part of the program.
const partsOfOtherThings =
  /^(?:files?|paths?|folders?|director(?:y|ies)|dir|extensions?|options?|flags?|commands?|sections?|threads?|stages?|phases?|statistics?)$/;
const readersOfStrings = /^(?:string|toWTFString|viewOf|decodeProgramString)$/;
const comparingFunctions: Record<Language, RegExp> = {
  "C++":
    /^(?:equal\w*|(?:starts|ends)With(?:IgnoringASCIICase)?|(?:contains|find|reverseFind)(?:IgnoringASCIICase)?|spanHas(?:Prefix|Suffix)\w*|starts_with|ends_with|strn?cmp|memcmp)$/,
  Rust:
    /^(?:starts_with|ends_with|contains(?:_key|_char)?|r?find|strip_prefix|strip_suffix|eq|ne|eq_ignore_ascii_case)$/,
};
const connectorsOf: Record<Language, Set<string>> = {
  "C++": new Set([".", "->", "::"]),
  Rust: new Set([".", "::", "?"]),
};

// Comments, strings, characters, and the numbers of C++, whose digits an apostrophe may separate.
const lexemes: Record<Language, RegExp> = {
  "C++":
    /\/\/.*|\/\*[\s\S]*?\*\/|\b(?:u8|[uUL])?R"([^\s()\\]*)\([\s\S]*?\)\1"|(?:\b(?:u8|[uUL]))?(?:"(?:[^"\\\n]|\\[\s\S])*"|'(?:[^'\\\n]|\\.)+')|\b\d(?:'?[\w.])*/g,
  Rust: /\/\/.*|\/\*(?:[^*/]|\*(?!\/)|\/(?!\*)|\/\*[\s\S]*?\*\/)*\*\/|\b[bc]?r(#*)"[\s\S]*?"\1|(?:\b[bc])?"(?:[^"\\]|\\[\s\S])*"|(?:\bb)?'(?:[^'\\\n]|\\(?:u\{[^}]*\}|x[\da-fA-F]{2}|.))'/gu,
};
// The name of the constant or of the list, and the first interned text that it holds.
const constantsHoldingText: Record<Language, RegExp> = {
  "C++": /\bconstexpr\s[^;=(){}]*?(\w+)(?:\[\w*\])?\s*=?\s*\{?\s*(?:"~|BuiltinNames::(\w+))/g,
  Rust: /\b(?:const|static)\s+(\w+)\s*:[^=]*=[\s&\[]*(?:"~|known::(\w+))|\blet\s+(\w+)\s*=\s*\[\s*known::(\w+)/g,
};
const tableOfInternedTexts: Record<Language, string> = { "C++": "BuiltinNames", Rust: "known" };
// What the language itself reads or writes under that very key, on whatever object it is handed: the links of prototypes, a property descriptor, the protocols of
// iteration, of promises and of conversion, the options of `import()`, the export `default`, and the mark that loaders read off what a CommonJS module exports.
// No binding stands behind such a key: a program that spells it means it. A well-known symbol is a thing, and no text at all.
const keysOfLanguage = new Set(
  `prototype __proto__ constructor length name default defaultKeyword __esModule with then next done value returnKeyword throwKeyword
   get set writable enumerable configurable toString valueOf toJSON`.split(/\s+/),
);
// `export=`, `missing=`: each ends in `=`, so no program can write one.
const namesOfBinder = new Set(
  `export_equals returned own_declaration anonymous_function object_literal computed assignment_declaration missing constructor_declaration
   call_signature construct_signature index_signature type_literal global_augmentation`.split(/\s+/),
);
const standsForName = (constant: string) =>
  !keysOfLanguage.has(constant) && !namesOfBinder.has(constant) && !/Symbol$|^sym_/.test(constant);
const tokenPattern = /"[^"]*"\w*|'~+'|\w+|::|->|=>|\.\.=?|&&|\|\||[-+*\/%&|^<>=!]=|\S/g;

/** The source at the same length and with the same lines: blanks for comments, and `~` for what stands between quotes. */
function mask(source: string, language: Language) {
  return source.replace(lexemes[language], lexeme => {
    if (lexeme.startsWith("/")) return lexeme.replace(/[^\n]/g, " ");
    if (/^\d/.test(lexeme)) return lexeme;
    const quote = /["']/.exec(lexeme)!;
    const close = lexeme.lastIndexOf(quote[0]);
    const contents = lexeme.slice(quote.index + 1, close).replace(/[^\n]/g, "~");
    return " ".repeat(quote.index) + quote[0] + contents + quote[0] + " ".repeat(lexeme.length - close - 1);
  });
}

const partsOf = (word: string) => word.replace(/([a-z\d])([A-Z])/g, "$1_$2").toLowerCase().split("_");

const isWordOfNameByWord = new Map<string, boolean>();
function isWordOfName(word: string) {
  let answer = isWordOfNameByWord.get(word);
  if (answer === undefined) {
    const parts = partsOf(word);
    answer = parts.some(part => partsOfNames.test(part)) && !parts.some(part => partsOfOtherThings.test(part));
    isWordOfNameByWord.set(word, answer);
  }
  return answer;
}

type Token = { text: string; at: number; line: number };

function comparisonsIn(language: Language, source: string, file: string) {
  const masked = mask(source, language);
  const sourceLines = source.split("\n");
  const indents = masked.split("\n").map(line => (line.trim() ? line.search(/\S/) : Infinity));
  const constants = new Set<string>();
  for (const found of masked.matchAll(constantsHoldingText[language])) {
    const interned = found[2] ?? found[4];
    if (interned === undefined || standsForName(interned)) constants.add(found[1] ?? found[3]);
  }
  const connectors = connectorsOf[language];
  const localsHoldingNameText = new Map<string, [number, number][]>();
  const findings = new Map<number, Finding>();

  const tokens: Token[] = [];
  const partner: number[] = [];
  const unclosed: number[] = [];
  let linesCounted = 0;
  let counted = 0;
  for (const found of masked.matchAll(tokenPattern)) {
    for (; counted < found.index!; counted++) if (masked[counted] === "\n") linesCounted++;
    const index = tokens.push({ text: found[0], at: found.index!, line: linesCounted }) - 1;
    partner.push(-1);
    if (/^[([{]$/.test(found[0])) unclosed.push(index);
    else if (/^[)\]}]$/.test(found[0]) && unclosed.length) {
      partner[index] = unclosed.pop()!;
      partner[partner[index]] = index;
    }
  }

  const textAt = (index: number) => tokens[index]?.text ?? "";
  const touchesNext = (index: number) =>
    tokens[index] !== undefined && tokens[index].at + tokens[index].text.length === tokens[index + 1]?.at;
  const isInternedText = (index: number) =>
    textAt(index - 1) === "::" && textAt(index - 2) === tableOfInternedTexts[language] && /^[A-Za-z_]/.test(textAt(index));
  const isLiteral = (index: number) =>
    /^["']~/.test(textAt(index)) ||
    constants.has(textAt(index)) ||
    (isInternedText(index) && standsForName(textAt(index)));
  const firstLiteral = (from: number, to: number) => {
    for (let index = from; index <= to; index++) if (isLiteral(index)) return index;
    return -1;
  };
  // `Atom::NONE`, `strings::split(..)`: a word in front of `::` is a type or a module.
  const isName = (index: number) => {
    const token = tokens[index];
    if (token === undefined || isLiteral(index) || isInternedText(index) || textAt(index + 1) === "::") return false;
    if (isWordOfName(token.text) || (textAt(index + 1) === "(" && readersOfStrings.test(token.text))) return true;
    return localsHoldingNameText.get(token.text)?.some(([from, to]) => from <= token.line && token.line < to) ?? false;
  };
  // What stands between the brackets of an index says which element, not what it holds.
  const isTextOfName = (from: number, to: number, except = -1) => {
    for (let index = from; index <= to; index++) {
      const isIndex = textAt(index) === "[" && touchesNext(index - 1) && /^[\w)\]]/.test(textAt(index - 1));
      if (index > from && isIndex && partner[index] > index) index = partner[index];
      else if (index !== except && isName(index)) return true;
    }
    return false;
  };
  // Passes over whole groups, and gives up where the group that holds `from` ends.
  const findAtThisDepth = (from: number, to: number, ...wanted: string[]) => {
    for (let index = from; index < to; index++) {
      if (wanted.includes(textAt(index))) return index;
      if (partner[index] > index) index = partner[index];
      else if (partner[index] >= 0) return -1;
    }
    return -1;
  };
  // An operand is a chain of words, calls and indexes: `program.strings.toWTFString(function.name)`, `atoms.bytes(name)?[1..]`.
  const startOfOperand = (last: number) => {
    let first = last;
    while (connectors.has(textAt(first))) first--;
    for (;;) {
      if (partner[first] >= 0 && partner[first] < first) {
        first = partner[first];
        if (touchesNext(first - 1) && /^[\w)\]]/.test(textAt(first - 1))) {
          first--;
          continue;
        }
      }
      let before = first - 1;
      while (connectors.has(textAt(before))) before--;
      if (before === first - 1 || !/^[\w)\]"']/.test(textAt(before))) return first;
      first = before;
    }
  };
  const endOfOperand = (first: number) => {
    let last = first;
    while (/^(?:&&?|[*!]|mut)$/.test(textAt(last))) last++;
    for (;;) {
      if (partner[last] > last) last = partner[last];
      while (touchesNext(last) && /^[([]$/.test(textAt(last + 1)) && partner[last + 1] > last) last = partner[last + 1];
      let after = last + 1;
      while (connectors.has(textAt(after))) after++;
      if (after === last + 1 || !/^\w/.test(textAt(after))) return after - 1;
      last = after;
    }
  };
  const report = (pattern: string, at: number, from: number, to: number) => {
    const line = tokens[at].line;
    if (findings.has(line)) return;
    const subject = source.slice(tokens[from].at, tokens[to].at + tokens[to].text.length).replace(/\s+/g, " ");
    findings.set(line, new Finding(file, line + 1, sourceLines[line].trim(), pattern, subject));
  };
  // `ExprKind::Ident(known::eval)`, `MemberKey::Name(known::eval)`, `keyOf(BuiltinNames::eval)`: what wraps the literal says that it is a name.
  const isHeldAsName = (index: number) => {
    for (let before = index - 1; before >= 0; before--) {
      if (partner[before] >= 0 && partner[before] < before) before = partner[before];
      else if (partner[before] > index)
        return textAt(before) === "(" && touchesNext(before - 1) && isWordOfName(textAt(before - 1));
    }
    return false;
  };
  const reportEachLiteral = (pattern: string, from: number, to: number, first: number, last: number) => {
    const isOfName = isTextOfName(first, last);
    for (let index = from; index < to; index++)
      if (isLiteral(index) && (isOfName || isHeldAsName(index))) report(pattern, index, first, last);
  };

  for (let at = 0; at < tokens.length; at++) {
    const word = textAt(at);
    const endOfArguments = textAt(at + 1) === "(" ? partner[at + 1] : -1;
    if (language === "Rust" && word === "#" && textAt(at + 1) === "[" && partner[at + 1] > at) {
      const attribute = tokens.slice(at + 2, partner[at + 1]).map(token => token.text);
      if (!attribute.includes("test") || attribute.includes("not") || attribute[0] === "cfg_attr") continue;
      const body = findAtThisDepth(partner[at + 1] + 1, tokens.length, "{", ";");
      if (body >= 0) at = Math.max(body, partner[body]);
    } else if (word === "==" || word === "!=") {
      const left = [startOfOperand(at - 1), at - 1] as const;
      const right = [at + 1, endOfOperand(at + 1)] as const;
      for (const [one, other] of [
        [right, left],
        [left, right],
      ]) {
        const literal = firstLiteral(...one);
        if (literal < 0 || !(isTextOfName(...other) || isHeldAsName(literal))) continue;
        report(word, literal, ...other);
        break;
      }
    } else if (endOfArguments > at && comparingFunctions[language].test(word)) {
      // What a closure compares is judged where it compares it.
      if (/^(?:\|\|?|move)$/.test(textAt(at + 2))) continue;
      const first = startOfOperand(endOfArguments);
      const literal = firstLiteral(first, endOfArguments);
      if (literal >= 0 && isTextOfName(first, endOfArguments, at)) report(word, literal, first, endOfArguments);
    } else if (language === "Rust" && word === "matches" && textAt(at + 1) === "!" && partner[at + 2] > at) {
      const comma = findAtThisDepth(at + 3, partner[at + 2], ",");
      if (comma < 0) continue;
      // What a guard compares is judged where it compares it, as in an arm of `match`.
      const guard = findAtThisDepth(comma + 1, partner[at + 2], "if");
      reportEachLiteral("matches!", comma + 1, guard < 0 ? partner[at + 2] : guard, at + 3, comma - 1);
    } else if (language === "Rust" && word === "match") {
      const open = findAtThisDepth(at + 1, tokens.length, "{");
      if (open < 0) continue;
      for (let arm = open + 1; arm < partner[open]; ) {
        const arrow = findAtThisDepth(arm, partner[open], "=>");
        if (arrow < 0) break;
        const guard = findAtThisDepth(arm, arrow, "if");
        reportEachLiteral("match", arm, guard < 0 ? arrow : guard, at + 1, open - 1);
        const end = textAt(arrow + 1) === "{" ? partner[arrow + 1] : findAtThisDepth(arrow + 1, partner[open], ",");
        if (end < 0) break;
        arm = end + 1;
      }
    } else if (language === "Rust" && word === "let") {
      const equals = findAtThisDepth(at + 1, tokens.length, "=", ";");
      if (textAt(equals) !== "=" || firstLiteral(at + 1, equals) < 0) continue;
      reportEachLiteral("let", at + 1, equals, equals + 1, endOfOperand(equals + 1));
    } else if (language === "C++" && word === "switch" && endOfArguments > at) {
      const isHash = (index: number) => textAt(index + 1) === "(" && partsOf(textAt(index)).includes("hash");
      const [first, last] = [at + 2, endOfArguments - 1];
      if (tokens.slice(first, endOfArguments).some((_, offset) => isHash(first + offset)))
        report("switch over a hash", at, first, last);
      else if (textAt(endOfArguments + 1) === "{" && isTextOfName(first, last))
        for (let label = endOfArguments + 2; label < partner[endOfArguments + 1]; label++) {
          const literal = textAt(label) === "case" ? [label + 1, label + 3].find(isLiteral) : undefined;
          if (literal !== undefined) report("case", literal, first, last);
        }
    } else if (word === "=" && /^[A-Za-z_]\w*$/.test(textAt(at - 1))) {
      // `let text = atoms.bytes(name);` makes `text` the text of a name down to the end of the block, which both formatters show by the indentation.
      const end = findAtThisDepth(at + 1, tokens.length, ";");
      if (end < 0 || endOfOperand(at + 1) !== end - 1 || !isTextOfName(at + 1, end - 1)) continue;
      const line = tokens[at].line;
      let endOfBlock = line + 1;
      while (endOfBlock < indents.length && indents[endOfBlock] >= indents[line]) endOfBlock++;
      const local = textAt(at - 1);
      localsHoldingNameText.set(local, [...(localsHoldingNameText.get(local) ?? []), [line, endOfBlock]]);
    }
  }
  return [...findings.values()].sort((one, other) => one.line - other.line);
}

// A folder of `load` goes by its own path, so that no entry of `allowed` covers a file there that has the name of one in src/aot.
function foldersOf(roots: Roots | string[]): { folder: string; prefix?: string }[] {
  if (Array.isArray(roots)) {
    const ofThisCheckout = Object.entries(rootsOfThisCheckout.load!);
    return roots.map(folder => ({ folder, prefix: ofThisCheckout.find(([, own]) => own === folder)?.[0] }));
  }
  const { engine, frontEnd, load = {} } = roots;
  return [
    ...[engine, frontEnd].flatMap(folder => (folder === undefined ? [] : [{ folder }])),
    ...Object.entries(load).map(([prefix, folder]) => ({ folder, prefix })),
  ];
}

function sourcesUnder(roots: Roots | string[]) {
  return foldersOf(roots).flatMap(({ folder, prefix }) =>
    readdirSync(folder, { recursive: true, encoding: "utf8" })
      .map(path => path.replaceAll("\\", "/"))
      .filter(path => languageOf(path) !== undefined)
      .sort()
      .map(path => ({ path: (prefix ?? folderOf[languageOf(path)!]) + path, file: join(folder, path) }))
      .filter(({ path }) => !isTest(path)),
  );
}

/** The path of each file that is read, written as in `allowed`. A root that holds nothing reports nothing, and that reads like a clean one. */
export const pathsRead = (roots: Roots | string[]) => sourcesUnder(roots).map(({ path }) => path);

// `isWanted` is asked about a file before it is read, and then about each line with a comparison.
function findUnder(roots: Roots | string[], isWanted: (path: string, line?: string) => boolean) {
  return sourcesUnder(roots)
    .filter(({ path }) => isWanted(path))
    .flatMap(({ path, file }) =>
      comparisonsIn(languageOf(path)!, readFileSync(file, "utf8"), file).filter(({ text }) => isWanted(path, text)),
    );
}

/** The findings in one text. The path is written as in `allowed` ("aot/walk/AOTWalk.cpp", "src/aot/lower/call.rs"): it gives the language, and whether the file is a test or allowed. */
export function findInSource(path: string, source: string): Finding[] {
  const language = languageOf(path);
  return language === undefined || isTest(path) || reasonToAllow(path) !== undefined
    ? []
    : comparisonsIn(language, source, path).filter(({ text }) => reasonToAllow(path, text) === undefined);
}

/**
 * One finding for each line that compares the text of a name with a literal, in every .h, .cpp and .rs file under the roots but tests and what `allowed` lists.
 * A root is the engine's folder `aot` or Bun's folder `src/aot`. The C++ under a root is taken for the engine's and the Rust for the front end's.
 */
export function findNamesComparedAsText(roots: Roots | string[]): Finding[] {
  return findUnder(roots, (path, line) => reasonToAllow(path, line) === undefined);
}

if (import.meta.main) {
  const folders = process.argv.slice(2).filter(word => !word.startsWith("--"));
  const roots = folders.length ? folders.map(folder => resolve(folder)) : rootsOfThisCheckout;
  if (!folders.length && !rootsOfThisCheckout.engine)
    console.error(
      "the engine's sources are not here (aot-sources beside this Bun, $BUN_WEBKIT_PATH, vendor/WebKit): its C++ is not read",
    );
  if (process.argv.includes("--allowed")) {
    for (const { paths, lines, reason } of allowed) {
      const covered = findUnder(roots, (path, line) => paths.test(path) && (!line || !lines || lines.test(line)));
      console.log([`${covered.length}: ${reason}`, ...covered.map(finding => `  ${finding}`)].join("\n"));
    }
  } else {
    const findings = findNamesComparedAsText(roots);
    if (findings.length) console.log(findings.join("\n"));
    console.error(`${findings.length} names compared as text`);
    process.exitCode = findings.length ? 1 : 0;
  }
}
