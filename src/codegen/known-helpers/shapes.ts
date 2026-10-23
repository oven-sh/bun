export interface NamedShape {
  readonly helper: string;
  readonly shape: string;
  readonly firstPublishedIn: string;
  readonly publishedName: string;
  readonly part?: number;
  readonly where?: string;
  readonly behavior: string;
}

export const namedShapes: readonly NamedShape[] = [
  {
    helper: "ExportStar",
    shape: "ExportStarOntoModuleExportsCopiesDefaultToo",
    firstPublishedIn: "typescript@1.5.3",
    publishedName: "__export",
    behavior:
      'One argument: the target is the `exports` of the module the helper stands in. `for..in` over the source (enumerable names, inherited ones too, no symbols). Skips a name when `exports.hasOwnProperty(p)` (the method is looked up on the target). Does NOT skip `"default"`. Copies the value once with `exports[p] = m[p]`: a plain assignment, no live binding. Returns nothing.',
  },
  {
    helper: "ExportStar",
    shape: "ExportStarCopiesDefaultToo",
    firstPublishedIn: "tslib@1.6.0",
    publishedName: "__exportStar",
    behavior:
      'As ExportStarOntoModuleExportsCopiesDefaultToo, with the target as the second argument: `for..in`, skips what `exports.hasOwnProperty(p)` reports, does NOT skip `"default"`, assigns the value once.',
  },
  {
    helper: "ExportStar",
    shape: "ExportStarCopiesNamesTheTargetLacks",
    firstPublishedIn: "tslib@1.13.0",
    publishedName: "__exportStar",
    behavior:
      'Skips `"default"`. `for..in`; skips what `exports.hasOwnProperty(p)` reports (the method is looked up on the target). Assigns the value once with `exports[p] = m[p]`: no live binding, no call of another helper.',
  },
  {
    helper: "ExportStar",
    shape: "ExportStarBindsNamesTheTargetReportsLacking",
    firstPublishedIn: "tslib@1.12.0",
    publishedName: "__exportStar",
    behavior:
      'Skips `"default"`. `for..in`; skips what `exports.hasOwnProperty(p)` reports (the method is looked up on the target, so a target without `Object.prototype` throws). Each remaining name goes through CreateBinding(target, source, name).',
  },
  {
    helper: "ExportStar",
    shape: "ExportStarBindsNamesTheTargetLacks",
    firstPublishedIn: "tslib@2.0.1",
    publishedName: "__exportStar",
    behavior:
      'Skips `"default"`. `for..in`; skips a name the target owns, asked with `Object.prototype.hasOwnProperty.call(o, p)`. Each remaining name goes through CreateBinding(target, source, name).',
  },
  {
    helper: "CreateBinding",
    shape: "CreateBindingDefinesGetter",
    firstPublishedIn: "tslib@1.12.0",
    publishedName: "__createBinding",
    behavior:
      "The branch taken when `Object.create` is truthy. (o, m, k, k2): k2 defaults to k when it is `undefined`. Always `Object.defineProperty(o, k2, { enumerable: true, get })` where the getter reads `m[k]` at each use: a live binding; not configurable, no setter. Throws if o already has a non-configurable k2.",
  },
  {
    helper: "CreateBinding",
    shape: "CreateBindingReusesDescriptor",
    firstPublishedIn: "tslib@2.4.0",
    publishedName: "__createBinding",
    behavior:
      "The branch taken when `Object.create` is truthy. Reads `Object.getOwnPropertyDescriptor(m, k)`. Defines that very descriptor on o when it is an accessor and `m.__esModule` is truthy, or a data property that is neither writable nor configurable. Otherwise (no own property, an accessor of a module without `__esModule`, a writable or configurable value) defines `{ enumerable: true, get }` reading `m[k]` at each use.",
  },
  {
    helper: "CreateBinding",
    shape: "CreateBindingCopiesValue",
    firstPublishedIn: "tslib@1.12.0",
    publishedName: "__createBinding",
    part: 2,
    behavior:
      "The branch taken when `Object.create` is falsy, and all of the helper in tslib 1.13.0 to 1.14.1. k2 defaults to k. `o[k2] = m[k]`: the value is copied once by plain assignment.",
  },
  {
    helper: "SetModuleDefault",
    shape: "SetModuleDefaultDefinesValue",
    firstPublishedIn: "tslib@1.12.0",
    publishedName: "__setModuleDefault",
    behavior:
      'The branch taken when `Object.create` is truthy. `Object.defineProperty(o, "default", { enumerable: true, value: v })`: not writable, not configurable.',
  },
  {
    helper: "SetModuleDefault",
    shape: "SetModuleDefaultAssigns",
    firstPublishedIn: "tslib@1.12.0",
    publishedName: "__setModuleDefault",
    part: 2,
    behavior: 'The branch taken when `Object.create` is falsy. `o["default"] = v`.',
  },
  {
    helper: "ImportDefault",
    shape: "ImportDefaultWrapsUnlessEsModule",
    firstPublishedIn: "tslib@1.9.0",
    publishedName: "__importDefault",
    behavior:
      "Returns the module itself when it is truthy and its `__esModule` is truthy; otherwise a new plain object `{ default: mod }` (writable, enumerable, configurable).",
  },
  {
    helper: "ImportStar",
    shape: "ImportStarCopiesValues",
    firstPublishedIn: "tslib@1.9.0",
    publishedName: "__importStar",
    where: "tslib.js",
    behavior:
      'Returns the module itself when `mod && mod.__esModule`. Otherwise a new plain object: `for..in` over mod when `mod != null`, keeping own names (`Object.hasOwnProperty.call(mod, k)`), values copied once by assignment, `"default"` included and then overwritten by `result["default"] = mod`.',
  },
  {
    helper: "ImportStar",
    shape: "ImportStarCopiesValues",
    firstPublishedIn: "tslib@1.9.0",
    publishedName: "__importStar",
    where: "tslib.es6.js",
    behavior: "The same, written `result.default = mod`.",
  },
  {
    helper: "ImportStar",
    shape: "ImportStarBindsDefaultToo",
    firstPublishedIn: "tslib@1.12.0",
    publishedName: "__importStar",
    behavior:
      'Returns the module itself when `mod && mod.__esModule`. Otherwise `for..in`, own names by `Object.hasOwnProperty.call(mod, k)`, each through CreateBinding(result, mod, k), `"default"` NOT skipped; then SetModuleDefault(result, mod): with the defining branches of both, a module that owns an enumerable `default` makes the second definition throw a TypeError.',
  },
  {
    helper: "ImportStar",
    shape: "ImportStarBindsOwnNamesAskingObjectHasOwnProperty",
    firstPublishedIn: "typescript@3.9.10",
    publishedName: "__importStar",
    behavior:
      "As ImportStarBindsOwnNames, but ownership is asked with `Object.hasOwnProperty.call(mod, k)` (the method is read from the `Object` constructor).",
  },
  {
    helper: "ImportStar",
    shape: "ImportStarBindsOwnNames",
    firstPublishedIn: "tslib@2.0.1",
    publishedName: "__importStar",
    behavior:
      'Returns the module itself when `mod && mod.__esModule`. Otherwise a new plain object: `for..in` over mod when `mod != null` (enumerable names only), skipping `"default"`, keeping own names by `Object.prototype.hasOwnProperty.call(mod, k)`, each through CreateBinding(result, mod, k); then SetModuleDefault(result, mod).',
  },
  {
    helper: "ImportStar",
    shape: "ImportStarBindsOwnPropertyNames",
    firstPublishedIn: "tslib@2.8.1",
    publishedName: "__importStar",
    behavior:
      'As ImportStarBindsOwnNames, but the names come from OwnPropertyNames(mod): own string names, the ones that are not enumerable too, in the order of `Object.getOwnPropertyNames`; `"default"` skipped.',
  },
  {
    helper: "ImportStar",
    shape: "ImportStarFactoryBindsOwnPropertyNames",
    firstPublishedIn: "typescript@5.7.3",
    publishedName: "__importStar",
    behavior:
      "The function that is called at once: it holds its own copy of OwnPropertyNamesReplacesItselfOnFirstCall in a local variable and returns a function that behaves as ImportStarBindsOwnPropertyNames.",
  },
  {
    helper: "OwnPropertyNames",
    shape: "OwnPropertyNamesReplacesItselfOnFirstCall",
    firstPublishedIn: "tslib@2.8.1",
    publishedName: "ownKeys",
    behavior:
      "At its first call assigns to its own variable `Object.getOwnPropertyNames`, or where that is falsy a function that collects the own enumerable names of a `for..in`; then calls what it assigned.",
  },
  {
    helper: "ClassPrivateFieldGet",
    shape: "ClassPrivateFieldGetFromWeakMap",
    firstPublishedIn: "tslib@1.11.0",
    publishedName: "__classPrivateFieldGet",
    behavior:
      '(receiver, privateMap). Throws `TypeError("attempted to get private field on non-instance")` unless `privateMap.has(receiver)`; returns `privateMap.get(receiver)`. Instance fields only.',
  },
  {
    helper: "ClassPrivateFieldGet",
    shape: "ClassPrivateFieldGetByKind",
    firstPublishedIn: "tslib@2.2.0",
    publishedName: "__classPrivateFieldGet",
    behavior:
      '(receiver, state, kind, f). kind "a" without f throws `TypeError("Private accessor was defined without a getter")`. The brand: when state is a function (a static member) `receiver === state` and f must be truthy; otherwise `state.has(receiver)` (a WeakMap for a field, a WeakSet for methods and accessors); failing it throws `TypeError("Cannot read private member from an object whose class did not declare it")`. Result: kind "m": f itself; kind "a": `f.call(receiver)`; kind "f" with f (a static field): `f.value`; else `state.get(receiver)`.',
  },
  {
    helper: "ClassPrivateFieldSet",
    shape: "ClassPrivateFieldSetInWeakMap",
    firstPublishedIn: "tslib@1.11.0",
    publishedName: "__classPrivateFieldSet",
    behavior:
      '(receiver, privateMap, value). Throws `TypeError("attempted to set private field on non-instance")` unless `privateMap.has(receiver)`; `privateMap.set(receiver, value)`; returns value.',
  },
  {
    helper: "ClassPrivateFieldSet",
    shape: "ClassPrivateFieldSetByKind",
    firstPublishedIn: "tslib@2.2.0",
    publishedName: "__classPrivateFieldSet",
    behavior:
      '(receiver, state, value, kind, f). kind "m" throws `TypeError("Private method is not writable")`; kind "a" without f throws `TypeError("Private accessor was defined without a setter")`. The brand as in ClassPrivateFieldGetByKind; failing it throws `TypeError("Cannot write private member to an object whose class did not declare it")`. kind "a": `f.call(receiver, value)`; with f (a static field): `f.value = value`; else `state.set(receiver, value)`. Returns value.',
  },
  {
    helper: "ClassPrivateFieldIn",
    shape: "ClassPrivateFieldInAsksStateOrComparesConstructor",
    firstPublishedIn: "typescript@4.5.5",
    publishedName: "__classPrivateFieldIn",
    behavior:
      "(state, receiver): note the order. Throws `TypeError(\"Cannot use 'in' operator on non-object\")` when receiver is null or neither an object nor a function. When state is a function (a static member): `receiver === state`; otherwise `state.has(receiver)`.",
  },
  {
    helper: "Assign",
    shape: "AssignCopiesOwnEnumerableNames",
    firstPublishedIn: "typescript@1.8.10",
    publishedName: "__assign",
    behavior:
      "The fallback that stands behind `Object.assign ||`. (t, ...sources): for each further argument a `for..in` keeping own names (`Object.prototype.hasOwnProperty.call(s, p)`), `t[p] = s[p]` (setters of t run). No symbols, unlike `Object.assign`. A null or undefined source is passed over. Returns t.",
  },
  {
    helper: "Assign",
    shape: "AssignReplacesItselfOnFirstCall",
    firstPublishedIn: "typescript@3.0.3",
    publishedName: "__assign",
    behavior:
      "At each call through this function assigns to its own variable `Object.assign`, or where that is falsy AssignCopiesOwnEnumerableNames written inline; then `__assign.apply(this, arguments)`. After the first call the variable holds `Object.assign` itself.",
  },
  {
    helper: "Assign",
    shape: "AssignReplacesItselfOnFirstCall",
    firstPublishedIn: "tslib@1.9.3",
    publishedName: "__assign",
    where: "tslib.es6.js",
    behavior: "The same; the inline fallback is a function expression with a name of its own.",
  },
  {
    helper: "Rest",
    shape: "RestThrowsOnNullSource",
    firstPublishedIn: "tslib@1.1.0",
    publishedName: "__rest",
    behavior:
      "(s, e): a new plain object with the own enumerable string names of s (`for..in` + `Object.prototype.hasOwnProperty.call`) that `e.indexOf(p) < 0`, then ALL own symbols not in e, enumerable or not. No test for null: `Object.getOwnPropertySymbols(null)` throws.",
  },
  {
    helper: "Rest",
    shape: "RestCopiesAllOwnSymbols",
    firstPublishedIn: "tslib@1.2.0",
    publishedName: "__rest",
    behavior:
      "As RestThrowsOnNullSource, with `s != null &&` before the symbols: a null source gives `{}`. Symbols that are not enumerable are copied too.",
  },
  {
    helper: "Rest",
    shape: "RestCopiesEnumerableOwnSymbols",
    firstPublishedIn: "tslib@1.10.0",
    publishedName: "__rest",
    behavior:
      "As RestCopiesAllOwnSymbols, but a symbol is copied only when `Object.prototype.propertyIsEnumerable.call(s, p[i])`: what the language's rest does, but for `e.indexOf` comparing keys with `===` (a numeric key in e must be a string to match).",
  },
  {
    helper: "Extends",
    shape: "ExtendsCopiesStaticsWithoutNullBase",
    firstPublishedIn: "typescript@1.5.3",
    publishedName: "__extends",
    behavior:
      "(d, b). Statics: `for..in` over b, `b.hasOwnProperty(p)`, `d[p] = b[p]`: copied once, d does not inherit from b. Prototype: `__.prototype = b.prototype; d.prototype = new __()` where `__` sets `this.constructor = d` (an enumerable own `constructor`). `extends null` throws on `b.prototype`.",
  },
  {
    helper: "Extends",
    shape: "ExtendsCopiesStatics",
    firstPublishedIn: "typescript@1.6.2",
    publishedName: "__extends",
    behavior:
      "As ExtendsCopiesStaticsWithoutNullBase, but `b === null` gives `d.prototype = Object.create(null)` (and no `constructor`).",
  },
  {
    helper: "Extends",
    shape: "ExtendsThroughExtendStatics",
    firstPublishedIn: "tslib@1.5.0",
    publishedName: "__extends",
    behavior: "Statics through ExtendStatics(d, b); the prototype as in ExtendsCopiesStatics. No test of b.",
  },
  {
    helper: "Extends",
    shape: "ExtendsThroughExtendStaticsChecksBase",
    firstPublishedIn: "tslib@2.1.0",
    publishedName: "__extends",
    behavior:
      'As ExtendsThroughExtendStatics, after: b neither a function nor null throws `TypeError("Class extends value " + String(b) + " is not a constructor or null")`.',
  },
  {
    helper: "Extends",
    shape: "ExtendsFactoryPicksExtendStaticsAtOnce",
    firstPublishedIn: "typescript@2.2.2",
    publishedName: "__extends",
    behavior:
      "The function that is called at once. Its local `extendStatics` is chosen then: `Object.setPrototypeOf`, else (where `{ __proto__: [] } instanceof Array`) `d.__proto__ = b`, else the copy of names that `b.hasOwnProperty(p)` reports. Returns a function that behaves as ExtendsThroughExtendStatics.",
  },
  {
    helper: "Extends",
    shape: "ExtendsFactoryPicksExtendStaticsOnFirstCall",
    firstPublishedIn: "typescript@3.0.3",
    publishedName: "__extends",
    behavior:
      "As ExtendsFactoryPicksExtendStaticsAtOnce, but the choice is made by a local function that replaces itself at its first call.",
  },
  {
    helper: "Extends",
    shape: "ExtendsFactoryAsksObjectPrototype",
    firstPublishedIn: "typescript@4.0.8",
    publishedName: "__extends",
    behavior:
      "As ExtendsFactoryPicksExtendStaticsOnFirstCall; the last fallback asks `Object.prototype.hasOwnProperty.call(b, p)`.",
  },
  {
    helper: "Extends",
    shape: "ExtendsFactoryChecksBase",
    firstPublishedIn: "typescript@4.2.4",
    publishedName: "__extends",
    behavior:
      "As ExtendsFactoryAsksObjectPrototype; the returned function first throws the TypeError of ExtendsThroughExtendStaticsChecksBase.",
  },
  {
    helper: "ExtendStatics",
    shape: "ExtendStaticsSetsProto",
    firstPublishedIn: "tslib@1.5.0",
    publishedName: "extendStatics",
    behavior: "Stands behind `Object.setPrototypeOf || ({ __proto__: [] } instanceof Array && ..)`. `d.__proto__ = b`.",
  },
  {
    helper: "ExtendStatics",
    shape: "ExtendStaticsCopiesNamesTheBaseReportsOwning",
    firstPublishedIn: "tslib@1.5.0",
    publishedName: "extendStatics",
    part: 2,
    behavior: "The last fallback. `for..in` over b, `b.hasOwnProperty(p)`, `d[p] = b[p]`.",
  },
  {
    helper: "ExtendStatics",
    shape: "ExtendStaticsCopiesOwnNames",
    firstPublishedIn: "tslib@2.0.1",
    publishedName: "extendStatics",
    part: 2,
    behavior: "The last fallback. `for..in` over b, `Object.prototype.hasOwnProperty.call(b, p)`, `d[p] = b[p]`.",
  },
  {
    helper: "ExtendStatics",
    shape: "ExtendStaticsReplacesItselfAskingTheBase",
    firstPublishedIn: "tslib@1.9.3",
    publishedName: "extendStatics",
    where: "tslib.es6.js",
    behavior:
      "Assigns to its own variable `Object.setPrototypeOf`, else ExtendStaticsSetsProto, else ExtendStaticsCopiesNamesTheBaseReportsOwning, all written inline; then calls it.",
  },
  {
    helper: "ExtendStatics",
    shape: "ExtendStaticsReplacesItself",
    firstPublishedIn: "tslib@2.0.1",
    publishedName: "extendStatics",
    where: "tslib.es6.js",
    behavior: "As ExtendStaticsReplacesItselfAskingTheBase, with ExtendStaticsCopiesOwnNames as the last fallback.",
  },
  {
    helper: "Awaiter",
    shape: "AwaiterTakesPromiseConstructor",
    firstPublishedIn: "typescript@1.6.2",
    publishedName: "__awaiter",
    behavior:
      "(thisArg, _arguments, Promise, generator): the third argument is required. `generator.call(thisArg, _arguments)`: the arguments object is passed as ONE argument. A yielded value is used as it is when `value instanceof Promise && value.constructor === Promise`, else wrapped in `new Promise`. The generator starts inside the executor, synchronously.",
  },
  {
    helper: "Awaiter",
    shape: "AwaiterWrapsEveryValue",
    firstPublishedIn: "typescript@1.8.10",
    publishedName: "__awaiter",
    behavior:
      "(thisArg, _arguments, P, generator): P defaults to the global `Promise`. `generator.apply(thisArg, _arguments)`: _arguments must be array-like or undefined is passed to apply. EVERY yielded value is wrapped: `new P(resolve => resolve(value)).then(fulfilled, rejected)`: a native promise costs two more ticks than `await`. Starts synchronously inside the executor; a throw rejects.",
  },
  {
    helper: "Awaiter",
    shape: "AwaiterWrapsEveryValue",
    firstPublishedIn: "tslib@1.1.0",
    publishedName: "__awaiter",
    where: "tslib.js",
    behavior: 'The same, written `generator["throw"](value)`.',
  },
  {
    helper: "Awaiter",
    shape: "AwaiterWrapsEveryValueDefaultsArguments",
    firstPublishedIn: "tslib@1.3.0",
    publishedName: "__awaiter",
    where: "tslib.js",
    behavior: "As AwaiterWrapsEveryValue, with `generator.apply(thisArg, _arguments || [])`.",
  },
  {
    helper: "Awaiter",
    shape: "AwaiterWrapsEveryValueDefaultsArguments",
    firstPublishedIn: "tslib@1.3.0",
    publishedName: "__awaiter",
    where: "tslib.es6.js",
    behavior: "The same, written `generator.throw(value)`.",
  },
  {
    helper: "Awaiter",
    shape: "AwaiterAdoptsPromises",
    firstPublishedIn: "typescript@3.6.5",
    publishedName: "__awaiter",
    behavior:
      "As AwaiterWrapsEveryValueDefaultsArguments, but a yielded value that is `instanceof P` is used as it is (`adopt`), so a native promise takes the ticks of `.then` alone; anything else is wrapped in `new P`.",
  },
  {
    helper: "Generator",
    shape: "GeneratorWithoutIterator",
    firstPublishedIn: "tslib@1.1.0",
    publishedName: "__generator",
    behavior:
      '(thisArg, body): the state machine. Returns a plain `{ next, throw, return }`: NOT iterable. A delegate (`yield*`, op 5) is driven by `y[op[0] & 2 ? "return" : op[0] ? "throw" : "next"]`; when the method is missing the operation falls to the body. Re-entry throws `TypeError("Generator is already executing.")`.',
  },
  {
    helper: "Generator",
    shape: "GeneratorIsIterable",
    firstPublishedIn: "tslib@1.6.0",
    publishedName: "__generator",
    behavior:
      'As GeneratorWithoutIterator, and where `typeof Symbol === "function"` the result has `[Symbol.iterator]` returning itself.',
  },
  {
    helper: "Generator",
    shape: "GeneratorClosesDelegateWithoutThrow",
    firstPublishedIn: "tslib@1.9.2",
    publishedName: "__generator",
    behavior:
      "As GeneratorIsIterable, but `throw` on a delegate that has no `throw` first calls its `return`; and a delegate that finishes under `return` makes the outer generator return its value (`op = [op[0] & 2, t.value]`).",
  },
  {
    helper: "Generator",
    shape: "GeneratorStopsWhenClosedBeforeStart",
    firstPublishedIn: "tslib@2.4.1",
    publishedName: "__generator",
    behavior:
      "As GeneratorClosesDelegateWithoutThrow, but `return` or `throw` before the first `next` finishes the generator without running the body (`while (g && (g = 0, op[0] && (_ = 0)), _)`).",
  },
  {
    helper: "Generator",
    shape: "GeneratorInheritsIteratorPrototype",
    firstPublishedIn: "tslib@2.7.0",
    publishedName: "__generator",
    behavior:
      'As GeneratorStopsWhenClosedBeforeStart, but the result is `Object.create((typeof Iterator === "function" ? Iterator : Object).prototype)`: iterator helpers work on it.',
  },
  {
    helper: "Values",
    shape: "ValuesFallsBackToIndexes",
    firstPublishedIn: "tslib@1.6.0",
    publishedName: "__values",
    behavior:
      "(o): `o[Symbol.iterator].call(o)` when there is one; otherwise, whatever o is, an object with only `next` that walks `o[0..o.length)`; never throws for what is not iterable.",
  },
  {
    helper: "Values",
    shape: "ValuesThrowsOnNonIterables",
    firstPublishedIn: "typescript@3.6.5",
    publishedName: "__values",
    behavior:
      'As ValuesFallsBackToIndexes, but the walk by index needs `o && typeof o.length === "number"`; otherwise `TypeError("Object is not iterable.")`, or `"Symbol.iterator is not defined."` without `Symbol`.',
  },
  {
    helper: "Read",
    shape: "ReadCollectsUpToCount",
    firstPublishedIn: "tslib@1.6.0",
    publishedName: "__read",
    behavior:
      "(o, n): without `o[Symbol.iterator]` returns o ITSELF. Otherwise a new array of up to n values (all when n is undefined); closes the iterator (`return`) when it stopped before the end or when `next` threw, and rethrows.",
  },
  {
    helper: "Spread",
    shape: "SpreadConcatenatesReads",
    firstPublishedIn: "tslib@1.6.0",
    publishedName: "__spread",
    behavior:
      "(...iterables): `ar = ar.concat(Read(arguments[i]))` for each: a new array each round; `concat` spreads what Read returns.",
  },
  {
    helper: "SpreadArrays",
    shape: "SpreadArraysCopiesByIndex",
    firstPublishedIn: "tslib@1.10.0",
    publishedName: "__spreadArrays",
    behavior:
      "(...arrays): sums the `length`s, `Array(s)`, copies by index. No iterator is used; holes become `undefined` values.",
  },
  {
    helper: "SpreadArray",
    shape: "SpreadArrayAppendsInPlace",
    firstPublishedIn: "tslib@2.1.0",
    publishedName: "__spreadArray",
    behavior:
      "(to, from): writes `from[i]` at `to[to.length + i]`: CHANGES and returns `to`. Holes become `undefined` values.",
  },
  {
    helper: "SpreadArray",
    shape: "SpreadArrayConcatenatesSource",
    firstPublishedIn: "tslib@2.3.0",
    publishedName: "__spreadArray",
    behavior:
      "(to, from, pack): with pack, or with two arguments, a `from` with holes is copied with the holes filled by `undefined`. Returns `to.concat(ar || from)`: a NEW array; a `from` that is not an array (an arguments object) is appended as ONE element.",
  },
  {
    helper: "SpreadArray",
    shape: "SpreadArrayConcatenatesCopy",
    firstPublishedIn: "tslib@2.3.1",
    publishedName: "__spreadArray",
    behavior:
      "As SpreadArrayConcatenatesSource, but returns `to.concat(ar || Array.prototype.slice.call(from))`: any array-like is spread.",
  },
  {
    helper: "Decorate",
    shape: "DecorateReducesByArgumentCount",
    firstPublishedIn: "typescript@1.5.3",
    publishedName: "__decorate",
    behavior:
      "(decorators, target, key, desc). `Reflect.decorate` when it is a function. Else by `arguments.length`: 2: class decorators right to left, each result replaces the class if truthy; 3: called for effect, returns undefined; 4: threads the descriptor. Does NOT define the property: the caller does.",
  },
  {
    helper: "Decorate",
    shape: "DecorateLoopsAndDefines",
    firstPublishedIn: "typescript@1.7.5",
    publishedName: "__decorate",
    behavior:
      "(decorators, target, key, desc). r starts as target (fewer than 3 arguments), or `Object.getOwnPropertyDescriptor(target, key)` when desc is null, or desc. `Reflect.decorate` when it is a function; else right to left `d(r)`, `d(target, key, r)` or `d(target, key)`, a truthy result replaces r. With 4 arguments and a truthy r: `Object.defineProperty(target, key, r)`. Returns r.",
  },
  {
    helper: "Metadata",
    shape: "MetadataAsksReflect",
    firstPublishedIn: "typescript@1.5.3",
    publishedName: "__metadata",
    behavior:
      "(k, v): `Reflect.metadata(k, v)` when `Reflect` is an object and `Reflect.metadata` a function; otherwise undefined, which Decorate passes over.",
  },
  {
    helper: "Param",
    shape: "ParamPassesIndex",
    firstPublishedIn: "typescript@1.5.3",
    publishedName: "__param",
    behavior: "(paramIndex, decorator): returns `function (target, key) { decorator(target, key, paramIndex); }`.",
  },
  {
    helper: "EsDecorate",
    shape: "EsDecorateAppendsInitializers",
    firstPublishedIn: "tslib@2.5.0",
    publishedName: "__esDecorate",
    behavior:
      "Standard decorators, right to left. Initializers that field and accessor decorators return are PUSHED: they run in the reverse of the order of the proposal.",
  },
  {
    helper: "EsDecorate",
    shape: "EsDecoratePrependsInitializers",
    firstPublishedIn: "tslib@2.5.1",
    publishedName: "__esDecorate",
    behavior:
      "As EsDecorateAppendsInitializers, with `initializers.unshift`: they run in the order the decorators are written.",
  },
  {
    helper: "RunInitializers",
    shape: "RunInitializersThreadsValue",
    firstPublishedIn: "tslib@2.5.0",
    publishedName: "__runInitializers",
    behavior:
      "(thisArg, initializers, value): with a third argument each initializer gets the last value and gives the next; returns it. Without one: called for effect, returns undefined.",
  },
  {
    helper: "PropKey",
    shape: "PropKeyKeepsSymbols",
    firstPublishedIn: "tslib@2.5.0",
    publishedName: "__propKey",
    behavior: '(x): a symbol as it is, anything else `"".concat(x)`.',
  },
  {
    helper: "SetFunctionName",
    shape: "SetFunctionNameDefinesName",
    firstPublishedIn: "tslib@2.5.0",
    publishedName: "__setFunctionName",
    behavior:
      '(f, name, prefix): a symbol becomes `"[description]"` or `""`; `Object.defineProperty(f, "name", { configurable: true, value })` with `prefix + " " + name` when there is a prefix. Returns f.',
  },
  {
    helper: "MakeTemplateObject",
    shape: "MakeTemplateObjectDefinesRaw",
    firstPublishedIn: "tslib@1.8.0",
    publishedName: "__makeTemplateObject",
    behavior:
      '(cooked, raw): `Object.defineProperty(cooked, "raw", { value: raw })` (or an assignment without `Object.defineProperty`); returns cooked. Neither array is frozen, unlike the language\'s.',
  },
  {
    helper: "AsyncValues",
    shape: "AsyncValuesReturnsSyncIteratorThroughValues",
    firstPublishedIn: "tslib@1.6.0",
    publishedName: "__asyncValues",
    behavior:
      '(o). Throws `TypeError("Symbol.asyncIterator is not defined.")` without it. `o[Symbol.asyncIterator].call(o)` when there is one; else Values(o), the SYNC iterator as it is: its results are not promises. `__values` is a variable of the file.',
  },
  {
    helper: "AsyncValues",
    shape: "AsyncValuesReturnsSyncIterator",
    firstPublishedIn: "typescript@2.3.4",
    publishedName: "__asyncValues",
    where: "async-generators --target ES2015 --module CommonJS",
    behavior:
      'The same text in a file that does not define `__values`: `typeof __values === "function"` asks for a GLOBAL of that name; without one: `o[Symbol.iterator]()`.',
  },
  {
    helper: "AsyncValues",
    shape: "AsyncValuesWrapsSyncIteratorThroughValues",
    firstPublishedIn: "tslib@1.9.1",
    publishedName: "__asyncValues",
    behavior:
      "As AsyncValuesReturnsSyncIteratorThroughValues, but the sync iterator is wrapped: `next`, `throw`, `return` (those it has) return promises that await the value; the wrapper has `[Symbol.asyncIterator]`.",
  },
  {
    helper: "AsyncValues",
    shape: "AsyncValuesWrapsSyncIterator",
    firstPublishedIn: "typescript@2.9.2",
    publishedName: "__asyncValues",
    where: "async-generators --target ES2015 --module CommonJS",
    behavior:
      "The text of AsyncValuesWrapsSyncIteratorThroughValues in a file that does not define `__values`: a global of that name is asked for.",
  },
  {
    helper: "AsyncGenerator",
    shape: "AsyncGeneratorReadsTaggedPairsWithDelegate",
    firstPublishedIn: "tslib@1.6.0",
    publishedName: "__asyncGenerator",
    behavior:
      '(thisArg, _arguments, generator). The generator yields `["yield" | "await" | "delegate", value]`. A yielded value is NOT awaited.',
  },
  {
    helper: "AsyncGenerator",
    shape: "AsyncGeneratorReadsTaggedPairs",
    firstPublishedIn: "tslib@1.6.1",
    publishedName: "__asyncGenerator",
    behavior: 'The generator yields `["yield" | "await", value]`; a yielded value is awaited before it is delivered.',
  },
  {
    helper: "AsyncGenerator",
    shape: "AsyncGeneratorReadsAwaitObjects",
    firstPublishedIn: "tslib@1.7.0",
    publishedName: "__asyncGenerator",
    behavior:
      "An await is a yielded `instanceof Await`; anything else is delivered. Requests queue in q. The result is a plain object with the methods the generator has and `[Symbol.asyncIterator]`. `return(v)` does not await v.",
  },
  {
    helper: "AsyncGenerator",
    shape: "AsyncGeneratorAwaitsReturnValue",
    firstPublishedIn: "typescript@5.3.3",
    publishedName: "__asyncGenerator",
    behavior: "As AsyncGeneratorReadsAwaitObjects, but `return(v)` first awaits v (`awaitReturn`).",
  },
  {
    helper: "AsyncGenerator",
    shape: "AsyncGeneratorInheritsAsyncIteratorPrototype",
    firstPublishedIn: "tslib@2.7.0",
    publishedName: "__asyncGenerator",
    behavior:
      'As AsyncGeneratorAwaitsReturnValue, but the result is `Object.create((typeof AsyncIterator === "function" ? AsyncIterator : Object).prototype)`.',
  },
  {
    helper: "AsyncDelegator",
    shape: "AsyncDelegatorYieldsDelegatePairs",
    firstPublishedIn: "tslib@1.6.0",
    publishedName: "__asyncDelegator",
    behavior: 'Goes with AsyncGeneratorReadsTaggedPairsWithDelegate: each step yields `["delegate", result]`.',
  },
  {
    helper: "AsyncDelegator",
    shape: "AsyncDelegatorYieldsAwaitAndYieldPairs",
    firstPublishedIn: "tslib@1.6.1",
    publishedName: "__asyncDelegator",
    behavior: 'Goes with AsyncGeneratorReadsTaggedPairs: alternates `["await", result]` and `["yield", value]`.',
  },
  {
    helper: "AsyncDelegator",
    shape: "AsyncDelegatorSkipsMissingMethods",
    firstPublishedIn: "tslib@1.7.0",
    publishedName: "__asyncDelegator",
    behavior:
      "Goes with Await objects. Only the methods the inner iterator has are defined. Every second call passes the awaited result through.",
  },
  {
    helper: "AsyncDelegator",
    shape: "AsyncDelegatorRethrows",
    firstPublishedIn: "tslib@1.7.1",
    publishedName: "__asyncDelegator",
    behavior: "As AsyncDelegatorSkipsMissingMethods, but the second half of `throw` rethrows the awaited rejection.",
  },
  {
    helper: "AsyncDelegator",
    shape: "AsyncDelegatorKeepsThrowWithoutMethod",
    firstPublishedIn: "tslib@1.9.1",
    publishedName: "__asyncDelegator",
    behavior:
      "As AsyncDelegatorRethrows, but a method the inner iterator lacks is defined as the fallback (`throw` rethrows; `next` and `return` are undefined).",
  },
  {
    helper: "AsyncDelegator",
    shape: "AsyncDelegatorNeverReportsDoneWhileAwaiting",
    firstPublishedIn: "tslib@2.5.0",
    publishedName: "__asyncDelegator",
    behavior: 'As AsyncDelegatorKeepsThrowWithoutMethod, with `done: false` where that one has `done: n === "return"`.',
  },
  {
    helper: "Await",
    shape: "AwaitBoxesValue",
    firstPublishedIn: "tslib@1.7.0",
    publishedName: "__await",
    where: "tslib.js",
    behavior:
      "(v): called or constructed, gives an instance of itself with `v`. AsyncGenerator tests `instanceof` against the same variable.",
  },
  {
    helper: "Await",
    shape: "AwaitBoxesValue",
    firstPublishedIn: "tslib@1.7.0",
    publishedName: "__await",
    where: "tslib.es6.js",
    behavior: "The same as a function declaration that names itself.",
  },
  {
    helper: "AddDisposableResource",
    shape: "AddDisposableResourceRefusesFunctions",
    firstPublishedIn: "tslib@2.6.0",
    publishedName: "__addDisposableResource",
    behavior:
      '(env, value, async). null and undefined are accepted (an async one still pushes `{ async: true }`). A value that is not an object throws `TypeError("Object expected.")`: a FUNCTION too.',
  },
  {
    helper: "AddDisposableResource",
    shape: "AddDisposableResourceAcceptsFunctions",
    firstPublishedIn: "tslib@2.6.1",
    publishedName: "__addDisposableResource",
    behavior: "As AddDisposableResourceRefusesFunctions, but a function is accepted as a resource.",
  },
  {
    helper: "AddDisposableResource",
    shape: "AddDisposableResourceGuardsSyncDisposeWhenAsync",
    firstPublishedIn: "tslib@2.6.3",
    publishedName: "__addDisposableResource",
    behavior:
      "As AddDisposableResourceAcceptsFunctions, but under `await using` a `Symbol.dispose` method is wrapped: its result is dropped and its throw becomes a rejected promise.",
  },
  {
    helper: "DisposeResources",
    shape: "DisposeResourcesAwaitsEveryAsyncEntry",
    firstPublishedIn: "tslib@2.6.0",
    publishedName: "__disposeResources",
    behavior:
      "(env): pops the stack; an async entry returns a promise and goes on in `then`. Errors chain through SuppressedError. Throws `env.error` at the end when there was one.",
  },
  {
    helper: "DisposeResources",
    shape: "DisposeResourcesAwaitsOnceForEmptyAsyncEntries",
    firstPublishedIn: "tslib@2.7.0",
    publishedName: "__disposeResources",
    behavior:
      "As DisposeResourcesAwaitsEveryAsyncEntry, but an `await using` of null or undefined costs one await in all, taken before the next sync entry or at the end (the state s).",
  },
  {
    helper: "DisposeResources",
    shape: "DisposeResourcesFactoryAwaitsEveryAsyncEntry",
    firstPublishedIn: "typescript@5.2.2",
    publishedName: "__disposeResources",
    behavior:
      'The function that is called at once with `typeof SuppressedError === "function" ? SuppressedError : <SuppressedErrorBuildsPlainError>` as its argument; returns DisposeResourcesAwaitsEveryAsyncEntry over that parameter.',
  },
  {
    helper: "DisposeResources",
    shape: "DisposeResourcesFactoryAwaitsOnceForEmptyAsyncEntries",
    firstPublishedIn: "typescript@5.6.3",
    publishedName: "__disposeResources",
    behavior: "The same factory around DisposeResourcesAwaitsOnceForEmptyAsyncEntries.",
  },
  {
    helper: "SuppressedError",
    shape: "SuppressedErrorBuildsPlainError",
    firstPublishedIn: "tslib@2.6.0",
    publishedName: "_SuppressedError",
    behavior:
      'The fallback behind `typeof SuppressedError === "function" ? SuppressedError :`. (error, suppressed, message): a plain `Error` with `name`, `error` and `suppressed` assigned.',
  },
  {
    helper: "RewriteRelativeImportExtension",
    shape: "RewriteRelativeImportExtensionMapsTsToJs",
    firstPublishedIn: "tslib@2.8.0",
    publishedName: "__rewriteRelativeImportExtension",
    behavior:
      "(path, preserveJsx): only a string that starts with `./` or `../`: `.ts`, `.mts`, `.cts` to `.js`, `.mjs`, `.cjs`; `.tsx` to `.js` or `.jsx`; `.d.ts` left alone.",
  },
  {
    helper: "ThrowTypeError",
    shape: "ThrowTypeErrorWithMessage",
    firstPublishedIn: "esbuild@0.21.5",
    publishedName: "__typeError",
    where: "--loader=ts --format=cjs --target=es2015",
    behavior: "(msg): `throw TypeError(msg)`: the global `TypeError` as it is at the call, called without `new`.",
  },
  {
    helper: "AccessCheck",
    shape: "AccessCheckThrows",
    firstPublishedIn: "esbuild@0.8.57",
    publishedName: "__accessCheck",
    where: "--loader=ts --format=cjs --target=es2015",
    behavior:
      '(obj, member, msg): throws `TypeError("Cannot " + msg)` unless `member.has(obj)` is truthy. member is the WeakMap of a private field, or the WeakSet that stands for the private methods and accessors of a class. Returns nothing.',
  },
  {
    helper: "AccessCheck",
    shape: "AccessCheckThrowsThroughThrowTypeError",
    firstPublishedIn: "esbuild@0.21.5",
    publishedName: "__accessCheck",
    where: "--loader=ts --format=cjs --target=es2015",
    behavior:
      'As AccessCheckThrows, written `member.has(obj) || ThrowTypeError("Cannot " + msg)`: returns what `has` returned.',
  },
  {
    helper: "PrivateGet",
    shape: "PrivateGetChecksAccess",
    firstPublishedIn: "esbuild@0.8.57",
    publishedName: "__privateGet",
    where: "private-fields --loader=ts --format=cjs --target=es2015",
    behavior:
      '(obj, member, getter): AccessCheck(obj, member, "read from private field"). Then `getter.call(obj)` when getter is truthy (a private accessor; member is the WeakSet of its class), else `member.get(obj)`. A static member has a collection of its own that holds the class.',
  },
  {
    helper: "PrivateGet",
    shape: "PrivateGetChecksAccess",
    firstPublishedIn: "esbuild@0.8.57",
    publishedName: "__privateGet",
    where: "--minify-syntax --loader=ts --format=cjs --target=es2015",
    behavior: "The same as one expression.",
  },
  {
    helper: "PrivateSet",
    shape: "PrivateSetChecksAccess",
    firstPublishedIn: "esbuild@0.8.57",
    publishedName: "__privateSet",
    where: "private-fields --loader=ts --format=cjs --target=es2015",
    behavior:
      '(obj, member, value, setter): AccessCheck(obj, member, "write to private field"). Then `setter.call(obj, value)` when setter is truthy, else `member.set(obj, value)`. Returns value.',
  },
  {
    helper: "PrivateSet",
    shape: "PrivateSetChecksAccess",
    firstPublishedIn: "esbuild@0.8.57",
    publishedName: "__privateSet",
    where: "--minify-syntax --loader=ts --format=cjs --target=es2015",
    behavior: "The same as one expression.",
  },
  {
    helper: "PrivateAdd",
    shape: "PrivateAddRefusesSecondAdd",
    firstPublishedIn: "esbuild@0.11.23",
    publishedName: "__privateAdd",
    where: "--loader=ts --format=cjs --target=es2015",
    behavior:
      '(obj, member, value): throws `TypeError("Cannot add the same private member more than once")` when `member.has(obj)`. Then `member.add(obj)` when `member instanceof WeakSet` (the global as it is at the call), else `member.set(obj, value)`. Returns nothing.',
  },
  {
    helper: "PrivateAdd",
    shape: "PrivateAddRefusesSecondAddThroughThrowTypeError",
    firstPublishedIn: "esbuild@0.21.5",
    publishedName: "__privateAdd",
    where: "--loader=ts --format=cjs --target=es2015",
    behavior:
      "As PrivateAddRefusesSecondAdd, as one expression that throws through ThrowTypeError: returns the collection, which `add` and `set` return.",
  },
  {
    helper: "PrivateMethod",
    shape: "PrivateMethodChecksAccess",
    firstPublishedIn: "esbuild@0.8.57",
    publishedName: "__privateMethod",
    where: "private-methods-and-statics --loader=ts --format=cjs --target=es2015",
    behavior: '(obj, member, method): AccessCheck(obj, member, "access private method"); returns method.',
  },
  {
    helper: "PrivateMethod",
    shape: "PrivateMethodChecksAccess",
    firstPublishedIn: "esbuild@0.8.57",
    publishedName: "__privateMethod",
    where: "--minify-syntax --loader=ts --format=cjs --target=es2015",
    behavior: "The same as one expression.",
  },
  {
    helper: "PrivateIn",
    shape: "PrivateInAsksCollection",
    firstPublishedIn: "esbuild@0.11.23",
    publishedName: "__privateIn",
    where: "--loader=ts --format=cjs --target=es2015",
    behavior:
      "(member, obj): note the order. Throws `TypeError('Cannot use the \"in\" operator on this value')` when `Object(obj) !== obj` (a primitive, null, undefined); returns `member.has(obj)`.",
  },
  {
    helper: "PrivateIn",
    shape: "PrivateInAsksCollectionThroughThrowTypeError",
    firstPublishedIn: "esbuild@0.21.5",
    publishedName: "__privateIn",
    where: "--loader=ts --format=cjs --target=es2015",
    behavior: "As PrivateInAsksCollection, as one expression that throws through ThrowTypeError.",
  },
  {
    helper: "PrivateAssign",
    shape: "PrivateAssignGivesSetter",
    firstPublishedIn: "esbuild@0.10.2",
    publishedName: "__privateAssign",
    where: "--loader=ts --format=cjs --target=es2015",
    behavior:
      "(obj, member, setter): a new object with a setter `_` and no getter: a write to it is PrivateSet(obj, member, value, setter). Stands where a private member is the target of a destructuring.",
  },
  {
    helper: "PrivateWrapper",
    shape: "PrivateWrapperGivesAccessor",
    firstPublishedIn: "esbuild@0.12.29",
    publishedName: "__privateWrapper",
    where: "--loader=ts --format=cjs --target=es2015",
    behavior:
      "(obj, member, setter, getter): a new object with one accessor `_`: a write to it is PrivateSet(obj, member, value, setter), a read of it PrivateGet(obj, member, getter). Stands where a private member is the target of a destructuring or of `++`.",
  },
  {
    helper: "DefineNormalProperty",
    shape: "DefineNormalPropertyDefinesWhatIsThere",
    firstPublishedIn: "esbuild@0.9.7",
    publishedName: "__defNormalProp",
    where: "--loader=tsx --format=cjs --target=es2015",
    behavior:
      "(obj, key, value): when `key in obj` (inherited keys too): `Object.defineProperty(obj, key, { enumerable: true, configurable: true, writable: true, value })`, so no setter runs; returns obj. Otherwise the plain assignment `obj[key] = value`; returns value. `Object.defineProperty` is read once, when the file starts.",
  },
  {
    helper: "SpreadValues",
    shape: "SpreadValuesDefinesOwnEnumerableKeys",
    firstPublishedIn: "esbuild@0.9.7",
    publishedName: "__assign",
    where: "jsx-spread --loader=tsx --format=cjs --target=es2015",
    behavior:
      "(a, b): one source. A falsy b counts as `{}`. `for..in` over b keeping own names, then, where `Object.getOwnPropertySymbols` was there when the file started, the enumerable own symbols of b, walked with `for..of` (the array iterator runs). Each goes through DefineNormalProperty(a, key, b[key]): what an object literal with a spread does, no setter of a runs. Returns a. Later published as `__spreadValues`.",
  },
  {
    helper: "SpreadValues",
    shape: "SpreadValuesDefinesOwnEnumerableKeys",
    firstPublishedIn: "esbuild@0.9.7",
    publishedName: "__assign",
    where: "--minify-syntax --loader=tsx --format=cjs --target=es2015",
    behavior: "The same, with `&&` for the inner `if`s.",
  },
  {
    helper: "SpreadProperties",
    shape: "SpreadPropertiesDefinesOwnDescriptors",
    firstPublishedIn: "esbuild@0.11.23",
    publishedName: "__spreadProps",
    where: "--loader=tsx --format=cjs --target=es2015",
    behavior:
      "(a, b): `Object.defineProperties(a, Object.getOwnPropertyDescriptors(b))`, both read once, when the file starts. b is the object literal that holds the properties written behind a spread: its getters and setters are carried over, not called. Returns a.",
  },
  {
    helper: "Rest",
    shape: "RestWalksSymbolsWithForOf",
    firstPublishedIn: "esbuild@0.8.57",
    publishedName: "__rest",
    where: "object-spread-and-rest --loader=ts --format=cjs --target=es2015",
    behavior:
      "(source, exclude): as RestCopiesEnumerableOwnSymbols, but `Object.prototype.hasOwnProperty`, `Object.getOwnPropertySymbols` and `Object.prototype.propertyIsEnumerable` are read once, when the file starts, and the symbols are walked with `for..of` (the array iterator runs). Later published as `__objRest`.",
  },
  {
    helper: "Rest",
    shape: "RestWalksSymbolsWithForOf",
    firstPublishedIn: "esbuild@0.8.57",
    publishedName: "__rest",
    where: "--minify-syntax --loader=ts --format=cjs --target=es2015",
    behavior: "The same, with `&&` for the inner `if`s.",
  },
  {
    helper: "PublicField",
    shape: "PublicFieldDefinesAndReturnsValue",
    firstPublishedIn: "esbuild@0.18.20",
    publishedName: "__publicField",
    where: "class-fields-and-names --loader=ts --format=cjs --target=es2015",
    behavior:
      '(obj, key, value): DefineNormalProperty(obj, key, value) with a key that is not a symbol turned into a string by `key + ""`. Returns value.',
  },
  {
    helper: "PublicField",
    shape: "PublicFieldDefinesAndReturnsValue",
    firstPublishedIn: "esbuild@0.18.20",
    publishedName: "__publicField",
    where: "--minify-syntax --loader=ts --format=cjs --target=es2015",
    behavior: "The same as one expression.",
  },
  {
    helper: "PublicField",
    shape: "PublicFieldDefines",
    firstPublishedIn: "esbuild@0.21.5",
    publishedName: "__publicField",
    where: "--loader=ts --format=cjs --target=es2015",
    behavior:
      "As PublicFieldDefinesAndReturnsValue, but returns what DefineNormalProperty returns: obj where the key was there, else value.",
  },
  {
    helper: "KeepName",
    shape: "KeepNameDefinesName",
    firstPublishedIn: "esbuild@0.8.57",
    publishedName: "__name",
    where: "--loader=ts --format=cjs --target=es2015",
    behavior:
      '(target, value): `Object.defineProperty(target, "name", { value, configurable: true })`: not writable, not enumerable, as the language makes it. `Object.defineProperty` is read once, when the file starts. Returns target. `--keep-names` puts a call of it around or behind every function and class.',
  },
  {
    helper: "MarkAsModule",
    shape: "MarkAsModuleDefinesFlag",
    firstPublishedIn: "esbuild@0.8.57",
    publishedName: "__markAsModule",
    where: "--loader=ts --format=cjs --target=es2015",
    behavior:
      '(target): `Object.defineProperty(target, "__esModule", { value: true })`: not enumerable, not writable, not configurable. Returns target.',
  },
  {
    helper: "Export",
    shape: "ExportDefinesGetters",
    firstPublishedIn: "esbuild@0.8.57",
    publishedName: "__export",
    where: "--loader=ts --format=cjs --target=es2015",
    behavior:
      "(target, all): all is an object literal of functions without parameters, `{ name: () => name }`. `for..in` over it; each name is defined on target as an accessor whose getter is that very function: enumerable, not configurable, no setter. `Object.defineProperty` is read once, when the file starts. Returns nothing.",
  },
  {
    helper: "Export",
    shape: "ExportMarksModuleAndDefinesGetters",
    firstPublishedIn: "esbuild@0.12.29",
    publishedName: "__export",
    where: "--loader=ts --format=cjs --target=es2015",
    behavior: "MarkAsModule(target), then as ExportDefinesGetters.",
  },
  {
    helper: "Export",
    shape: "ExportDefinesGettersAndSettersOfTheLastName",
    firstPublishedIn: "bun@1.0.0",
    publishedName: "__export",
    where: "--target=node --external",
    behavior:
      "As ExportDefinesGetters, but the accessors are configurable and have a setter, `newValue => all[name] = () => newValue`. name is the `var` of the loop, which all the setters share: each stores into all under the name the loop ended on. The accessor keeps the getter it was defined with, so a write through target never changes what target reads.",
  },
  {
    helper: "Export",
    shape: "ExportDefinesGettersAndBoundSetters",
    firstPublishedIn: "bun@1.3.10",
    publishedName: "__export",
    where: "--target=node --external",
    behavior:
      "As ExportDefinesGetters, but the accessors are configurable and have a setter, `ExportSetter.bind(all, name)`: it stores into all under its own name. The accessor keeps the getter it was defined with, so a write through target never changes what target reads.",
  },
  {
    helper: "ExportSetter",
    shape: "ExportSetterStoresBoundReturnValue",
    firstPublishedIn: "bun@1.3.10",
    publishedName: "__exportSetter",
    where: "--target=node --external",
    behavior:
      "(name, newValue), with the object of getters as `this`: `this[name] = ReturnValue.bind(null, newValue)`. Returns nothing.",
  },
  {
    helper: "ReturnValue",
    shape: "ReturnValueReturnsArgument",
    firstPublishedIn: "bun@1.3.10",
    publishedName: "__returnValue",
    where: "--target=node --external",
    behavior: "(v): returns v.",
  },
  {
    helper: "AccessProperty",
    shape: "AccessPropertyReadsThis",
    firstPublishedIn: "bun@1.3.10",
    publishedName: "__accessProp",
    where: "--target=node --external",
    behavior:
      "(key): `this[key]`. `AccessProperty.bind(module, key)` is the getter of a live binding: a bound function in place of a closure.",
  },
  {
    helper: "ExportAll",
    shape: "ExportAllTagsModuleWhenAsked",
    firstPublishedIn: "rolldown@1.0.0-beta.51",
    publishedName: "__export",
    where: 'exports: "named")',
    behavior:
      '(all, symbols): makes the target itself: a new plain object with the accessors of ExportDefinesGetters; with a truthy symbols also `Object.defineProperty(target, Symbol.toStringTag, { value: "Module" })`. Returns the target. Later published as `__exportAll`.',
  },
  {
    helper: "ExportAll",
    shape: "ExportAllTagsModuleUnlessRefused",
    firstPublishedIn: "rolldown@1.0.0-rc.7",
    publishedName: "__exportAll",
    where: 'exports: "named")',
    behavior:
      "(all, no_symbols): as ExportAllTagsModuleWhenAsked with the second parameter turned around: `Symbol.toStringTag` is defined unless it is truthy.",
  },
  {
    helper: "CopyProperties",
    shape: "CopyPropertiesDefinesGetters",
    firstPublishedIn: "esbuild@0.14.54",
    publishedName: "__copyProps",
    where: "array-spread-and-iteration --loader=ts --format=cjs --target=es2015",
    behavior:
      "(to, from, except, desc): desc is a variable, never passed. Does nothing unless from is an object that is not null, or a function. For each of `Object.getOwnPropertyNames(from)` (names that are not enumerable too, no symbols; walked with `for..of`) that to does not own (`Object.prototype.hasOwnProperty.call(to, key)`) and that is not `=== except`: defines on to `{ get: () => from[key], enumerable }`, a live binding, not configurable, no setter; enumerable as the own property of from is, true where `Object.getOwnPropertyDescriptor(from, key)` gives nothing. The four built-ins are read once, when the file starts. Returns to.",
  },
  {
    helper: "CopyProperties",
    shape: "CopyPropertiesDefinesGetters",
    firstPublishedIn: "esbuild@0.14.54",
    publishedName: "__copyProps",
    where: "--minify-syntax --loader=ts --format=cjs --target=es2015",
    behavior: "The same, as `--minify-syntax` writes it.",
  },
  {
    helper: "CopyProperties",
    shape: "CopyPropertiesDefinesBoundGetters",
    firstPublishedIn: "rolldown@1.0.0-beta.35",
    publishedName: "__copyProps",
    where: 'exports: "named")',
    behavior:
      "As CopyPropertiesDefinesGetters, but the names are walked by index (no iterator runs) and each getter is a bound function, `(k => from[k]).bind(null, key)`.",
  },
  {
    helper: "ReExport",
    shape: "ReExportDefinesGettersReturnsTarget",
    firstPublishedIn: "esbuild@0.8.57",
    publishedName: "__exportStar",
    where: "export-from --loader=ts --format=cjs --target=es2015",
    behavior:
      '(target, module, desc): what CopyPropertiesDefinesGetters(target, module, "default") does, written out. Returns target. Later published as `__reExport`.',
  },
  {
    helper: "ReExport",
    shape: "ReExportDefinesGettersReturnsTarget",
    firstPublishedIn: "esbuild@0.8.57",
    publishedName: "__exportStar",
    where: "--minify-syntax --loader=ts --format=cjs --target=es2015",
    behavior: "The same, as `--minify-syntax` writes it.",
  },
  {
    helper: "ReExport",
    shape: "ReExportThroughCopyProperties",
    firstPublishedIn: "esbuild@0.14.54",
    publishedName: "__reExport",
    where: "--loader=ts --format=cjs --target=es2015",
    behavior:
      '(target, mod, secondTarget): CopyProperties(target, mod, "default"); with a truthy secondTarget (`module.exports` of an entry point in CommonJS form) also CopyProperties(secondTarget, mod, "default"). Returns secondTarget.',
  },
  {
    helper: "ReExport",
    shape: "ReExportThroughCopyPropertiesTagsModule",
    firstPublishedIn: "rolldown@1.0.0-beta.51",
    publishedName: "__reExport",
    where: 'exports: "named")',
    behavior:
      '(target, mod, secondTarget, symbols): with a truthy symbols first `Object.defineProperty(.., Symbol.toStringTag, { value: "Module" })` on target and on a truthy secondTarget. Then as ReExportThroughCopyProperties. Returns nothing.',
  },
  {
    helper: "ReExport",
    shape: "ReExportDefinesEnumerableGetters",
    firstPublishedIn: "bun@1.0.0",
    publishedName: "__reExport",
    where: "--target=node --external",
    behavior:
      '(target, mod, secondTarget): no test of mod: null and undefined throw in `Object.getOwnPropertyNames`. For each own name of mod (walked with `for..of`) that target does not own and that is not "default": `{ get: () => mod[key], enumerable: true }`, enumerable whatever the property of mod is; not configurable. With a truthy secondTarget the names are read again and the same is done to it; then returns secondTarget, else nothing. The built-ins are read once, when the file starts.',
  },
  {
    helper: "ReExport",
    shape: "ReExportDefinesBoundGetters",
    firstPublishedIn: "bun@1.3.10",
    publishedName: "__reExport",
    where: "--target=node --external",
    behavior:
      "As ReExportDefinesEnumerableGetters, but the names are read once for both targets and each getter is `AccessProperty.bind(mod, key)`.",
  },
  {
    helper: "ReExport",
    shape: "ReExportDefinesBoundGettersOfObjects",
    firstPublishedIn: "bun@1.4.0",
    publishedName: "__reExport",
    where: "--target=node --external",
    behavior:
      "As ReExportDefinesBoundGetters, but a mod that is neither an object that is not null nor a function has no names: nothing throws.",
  },
  {
    helper: "ToModule",
    shape: "ToModuleBindsDefaultOfEsModules",
    firstPublishedIn: "esbuild@0.8.57",
    publishedName: "__toModule",
    where: "--loader=ts --format=cjs --target=es2015",
    behavior:
      '(module): a new object that inherits from the prototype of module (a plain object for null and undefined). `default` is defined first, enumerable, not configurable: a getter of `module.default` when `module.__esModule` is truthy and `"default" in module`, else the value module, not writable. Then MarkAsModule(result), then ReExport(result, module). Returns the result.',
  },
  {
    helper: "ToEsm",
    shape: "ToEsmThroughCopyProperties",
    firstPublishedIn: "esbuild@0.14.54",
    publishedName: "__toESM",
    where: "--loader=ts --format=cjs --target=es2015",
    behavior:
      '(mod, isNodeMode, target): target is a variable, never passed: a new object that inherits from the prototype of mod (a plain object for null and undefined). With a truthy isNodeMode, a falsy mod or a falsy `mod.__esModule`: `Object.defineProperty(target, "default", { value: mod, enumerable: true })`, not writable, not configurable. Then CopyProperties(target, mod): a `default` of mod is passed over where one was just defined. Returns target. A new object at every call.',
  },
  {
    helper: "ToEsm",
    shape: "ToEsmThroughCopyPropertiesAsksForOwnDefault",
    firstPublishedIn: "rolldown@1.2.14",
    publishedName: "__toESM",
    where: 'exports: "named")',
    behavior:
      'As ToEsmThroughCopyProperties, but `default` is also defined as mod when mod does not own a `default` (`Object.prototype.hasOwnProperty.call(mod, "default")`), whatever `mod.__esModule` says.',
  },
  {
    helper: "ToEsm",
    shape: "ToEsmDefinesEnumerableGetters",
    firstPublishedIn: "bun@1.0.0",
    publishedName: "__toESM",
    where: "--target=node --external",
    behavior:
      "As ToEsmThroughCopyProperties as far as `default`. Then, with no test of mod (null and undefined throw in `Object.getOwnPropertyNames`), each own name of mod that the result does not own: `{ get: () => mod[key], enumerable: true }`, enumerable whatever the property of mod is; not configurable. Returns the result.",
  },
  {
    helper: "ToCommonJs",
    shape: "ToCommonJsThroughCopyProperties",
    firstPublishedIn: "esbuild@0.14.54",
    publishedName: "__toCommonJS",
    where: "--loader=ts --format=cjs --target=es2015",
    behavior:
      '(mod): CopyProperties(`Object.defineProperty({}, "__esModule", { value: true })`, mod): an `__esModule` of mod is passed over. A new object at every call.',
  },
  {
    helper: "ToCommonJs",
    shape: "ToCommonJsPrefersModuleExportsMember",
    firstPublishedIn: "rolldown@1.0.0-beta.51",
    publishedName: "__toCommonJS",
    where: 'exports: "named")',
    behavior:
      'Returns `mod["module.exports"]` when mod owns a property of that name (`export { x as "module.exports" }`); otherwise as ToCommonJsThroughCopyProperties. A mod that is null or undefined throws.',
  },
  {
    helper: "ToCommonJs",
    shape: "ToCommonJsKeepsCopiesOnItself",
    firstPublishedIn: "bun@1.0.0",
    publishedName: "__toCommonJS",
    where: "--target=node --external",
    behavior:
      '(from): one copy for each module object, kept in a WeakMap in the property `moduleCache` of the helper function, which it reaches through its own variable; made at the first call. A new copy is `Object.defineProperty({}, "__esModule", { value: true })` with the getters of CopyPropertiesDefinesGetters(copy, from), written out. `set` of the WeakMap throws for a from that is no object.',
  },
  {
    helper: "CommonJs",
    shape: "CommonJsRunsCallbackOnce",
    firstPublishedIn: "esbuild@0.8.57",
    publishedName: "__commonJS",
    where: "namespaces --bundle --format=cjs --target=es2015",
    behavior:
      "(callback, module): module is a variable, never passed. Returns a function without parameters. Its first call sets `module = { exports: {} }` and then calls `callback(module.exports, module)`; every call returns `module.exports` as it is then. module is set before the callback runs: a call from inside it (a cycle) gets the unfinished exports, and a callback that threw is not run again.",
  },
  {
    helper: "CommonJs",
    shape: "CommonJsRunsCallbackOnce",
    firstPublishedIn: "esbuild@0.8.57",
    publishedName: "__commonJS",
    where: "--minify-syntax --bundle --format=cjs --target=es2015",
    behavior: "The same as one expression.",
  },
  {
    helper: "CommonJs",
    shape: "CommonJsRunsCallbackOnce",
    firstPublishedIn: "bun@1.0.0",
    publishedName: "__commonJS",
    where: "--target=node --external",
    behavior: "The same, written `mod || cb((mod = { exports: {} }).exports, mod), mod.exports`.",
  },
  {
    helper: "CommonJs",
    shape: "CommonJsRunsCallbackOnceThenDropsIt",
    firstPublishedIn: "rolldown@1.0.0-rc.18",
    publishedName: "__commonJSMin",
    behavior:
      "As CommonJsRunsCallbackOnce; when the callback has returned, `cb = null` lets go of it. A callback that threw is kept and still not run again.",
  },
  {
    helper: "CommonJs",
    shape: "CommonJsRunsFirstKeyOnce",
    firstPublishedIn: "esbuild@0.12.29",
    publishedName: "__commonJS",
    where: "commonjs-and-modules --bundle --format=cjs --target=es2015",
    behavior:
      "As CommonJsRunsCallbackOnce, but cb is an object literal with one method, named by the path of the module: the first call reads `cb[Object.keys(cb)[0]]` and calls it without a receiver. The function that is returned is an ordinary function named `__require`.",
  },
  {
    helper: "CommonJs",
    shape: "CommonJsRunsFirstKeyOnce",
    firstPublishedIn: "esbuild@0.12.29",
    publishedName: "__commonJS",
    where: "--minify-syntax --bundle --format=cjs --target=es2015",
    behavior: "The same; the function that is returned has no name of its own.",
  },
  {
    helper: "CommonJs",
    shape: "CommonJsRunsFirstOwnNameOnce",
    firstPublishedIn: "esbuild@0.14.54",
    publishedName: "__commonJS",
    where: "commonjs-and-modules --bundle --format=cjs --target=es2015",
    behavior:
      "As CommonJsRunsFirstKeyOnce, with `Object.getOwnPropertyNames`, read once when the file starts, in place of `Object.keys`.",
  },
  {
    helper: "CommonJs",
    shape: "CommonJsRunsFirstOwnNameOnce",
    firstPublishedIn: "esbuild@0.14.54",
    publishedName: "__commonJS",
    where: "--minify-syntax --bundle --format=cjs --target=es2015",
    behavior: "The same; the function that is returned has no name of its own.",
  },
  {
    helper: "CommonJs",
    shape: "CommonJsRunsFirstOwnNameOnceThenDropsIt",
    firstPublishedIn: "rolldown@1.0.0-rc.18",
    publishedName: "__commonJS",
    behavior:
      "As CommonJsRunsFirstOwnNameOnce without a name; when the method has returned, `cb = null` lets go of the object. A method that threw is kept and still not run again.",
  },
  {
    helper: "CommonJs",
    shape: "CommonJsRunsFirstOwnNameAgainAfterThrow",
    firstPublishedIn: "esbuild@0.28.2",
    publishedName: "__commonJS",
    where: "commonjs-and-modules --bundle --format=cjs --target=es2015",
    behavior:
      "As CommonJsRunsFirstOwnNameOnce, but what the method throws is caught, `mod = 0`, and thrown on: the next call makes a new module and runs the method again.",
  },
  {
    helper: "CommonJs",
    shape: "CommonJsRunsFirstOwnNameAgainAfterThrow",
    firstPublishedIn: "esbuild@0.28.2",
    publishedName: "__commonJS",
    where: "--minify-syntax --bundle --format=cjs --target=es2015",
    behavior: "The same; the function that is returned has no name of its own.",
  },
  {
    helper: "Esm",
    shape: "EsmRunsFunctionOnce",
    firstPublishedIn: "bun@1.0.0",
    publishedName: "__esm",
    where: "--target=node --external",
    behavior:
      "(fn, res): res is a variable, never passed. Returns a function without parameters. Its first call sets `fn = 0`, calls what fn was (with 0 as its argument) and keeps the result in res: a promise for a module with a top-level `await`. Every call returns res. fn is cleared before it runs: a call from inside it (a cycle), and a call after it threw, return res as it is: undefined.",
  },
  {
    helper: "Esm",
    shape: "EsmRunsFunctionOnceRethrows",
    firstPublishedIn: "bun@1.4.3",
    publishedName: "__esm",
    where: "--target=node --external",
    behavior:
      "(fn, res, err): as EsmRunsFunctionOnce, but what fn throws is kept (`err = [e]`) and thrown by that call and by every later one.",
  },
  {
    helper: "Esm",
    shape: "EsmRunsFunctionOnceRethrows",
    firstPublishedIn: "rolldown@1.1.5",
    publishedName: "__esmMin",
    behavior: "The same, with the test of err in front and the `try` around the whole expression.",
  },
  {
    helper: "Esm",
    shape: "EsmRunsFirstKeyOnce",
    firstPublishedIn: "esbuild@0.12.29",
    publishedName: "__esm",
    where: "commonjs-and-modules --bundle --format=cjs --target=es2015",
    behavior:
      "As EsmRunsFunctionOnce, but fn is an object literal with one method, named by the path of the module: the first call reads `fn[Object.keys(fn)[0]]` and calls it without a receiver. The function that is returned is an ordinary function named `__init`.",
  },
  {
    helper: "Esm",
    shape: "EsmRunsFirstKeyOnce",
    firstPublishedIn: "esbuild@0.12.29",
    publishedName: "__esm",
    where: "--minify-syntax --bundle --format=cjs --target=es2015",
    behavior: "The same; the function that is returned has no name of its own.",
  },
  {
    helper: "Esm",
    shape: "EsmRunsFirstOwnNameOnce",
    firstPublishedIn: "esbuild@0.14.54",
    publishedName: "__esm",
    where: "commonjs-and-modules --bundle --format=cjs --target=es2015",
    behavior:
      "As EsmRunsFirstKeyOnce, with `Object.getOwnPropertyNames`, read once when the file starts, in place of `Object.keys`.",
  },
  {
    helper: "Esm",
    shape: "EsmRunsFirstOwnNameOnce",
    firstPublishedIn: "esbuild@0.14.54",
    publishedName: "__esm",
    where: "--minify-syntax --bundle --format=cjs --target=es2015",
    behavior: "The same; the function that is returned has no name of its own.",
  },
  {
    helper: "Esm",
    shape: "EsmRunsFirstOwnNameOnceRethrows",
    firstPublishedIn: "esbuild@0.28.2",
    publishedName: "__esm",
    where: "commonjs-and-modules --bundle --format=cjs --target=es2015",
    behavior:
      "(fn, res, err): as EsmRunsFirstOwnNameOnce, but what the method throws is kept (`err = [e]`) and thrown by that call and by every later one.",
  },
  {
    helper: "Esm",
    shape: "EsmRunsFirstOwnNameOnceRethrows",
    firstPublishedIn: "esbuild@0.28.2",
    publishedName: "__esm",
    where: "--minify-syntax --bundle --format=cjs --target=es2015",
    behavior: "The same; the function that is returned has no name of its own.",
  },
  {
    helper: "Require",
    shape: "RequireFactoryPrefersRequire",
    firstPublishedIn: "esbuild@0.12.29",
    publishedName: "__require",
    where: "--bundle --format=esm --target=es2015",
    behavior:
      'The function that is called at once, with the other function of the definition as x. Gives the `require` in scope when `typeof require !== "undefined"`; else, where there is a `Proxy`, `new Proxy(x, { get })` whose `get` reads from `require` once there is one and from x until then; else x.',
  },
  {
    helper: "Require",
    shape: "RequireFactoryPrefersRequire",
    firstPublishedIn: "esbuild@0.15.18",
    publishedName: "__require",
    where: "--minify-syntax --bundle --format=esm --target=es2020",
    behavior: 'The same, written `< "u"`.',
  },
  {
    helper: "Require",
    shape: "RequireAppliesRequireOrThrowsNewError",
    firstPublishedIn: "esbuild@0.12.29",
    publishedName: "__require",
    part: 2,
    where: "--bundle --format=esm --target=es2015",
    behavior:
      "(x): `require.apply(this, arguments)` when `typeof require !== \"undefined\"` at the call; otherwise throws `new Error('Dynamic require of \"' + x + '\" is not supported')`.",
  },
  {
    helper: "Require",
    shape: "RequireAppliesRequireOrThrowsNewError",
    firstPublishedIn: "esbuild@0.15.18",
    publishedName: "__require",
    part: 2,
    where: "--minify-syntax --bundle --format=esm --target=es2020",
    behavior: 'The same, written `< "u"`.',
  },
  {
    helper: "Require",
    shape: "RequireAppliesRequireOrThrowsError",
    firstPublishedIn: "esbuild@0.18.20",
    publishedName: "__require",
    part: 2,
    where: "--bundle --format=esm --target=es2015",
    behavior: "As RequireAppliesRequireOrThrowsNewError, with `Error(..)` called without `new`.",
  },
  {
    helper: "Require",
    shape: "RequireAppliesRequireOrThrowsError",
    firstPublishedIn: "esbuild@0.18.20",
    publishedName: "__require",
    part: 2,
    where: "--minify-syntax --bundle --format=esm --target=es2020",
    behavior: 'The same, written `< "u"`.',
  },
  {
    helper: "Async",
    shape: "AsyncResolvesEveryValue",
    firstPublishedIn: "esbuild@0.8.57",
    publishedName: "__async",
    where: "async-functions --loader=ts --format=cjs --target=es2015",
    behavior:
      "(thisArg, args, generator): returns `new Promise` of the global. Inside the executor, at once: `generator = generator.apply(thisArg, args)`, then `next()`. Every yielded value goes through `Promise.resolve(value).then(fulfilled, rejected)`: a native promise is used as it is, as `await` uses it, but its `then` is looked up and called. What the generator returns resolves the promise, what it throws rejects it.",
  },
  {
    helper: "Async",
    shape: "AsyncResolvesEveryValue",
    firstPublishedIn: "esbuild@0.8.57",
    publishedName: "__async",
    where: "--minify-syntax --loader=ts --format=cjs --target=es2015",
    behavior: "The same, as `--minify-syntax` writes it.",
  },
];

export interface PassedOver {
  readonly tool: string;
  readonly what: string;
  readonly publishedNames: readonly string[];
}

export const passedOver: readonly PassedOver[] = [
  {
    tool: "esbuild",
    what: "decorators",
    publishedNames: [
      "__decorate",
      "__decorateClass",
      "__param",
      "__decorateParam",
      "__decorateElement",
      "__decoratorContext",
      "__decoratorMetadata",
      "__decoratorStart",
      "__expectFn",
      "__runInitializers",
    ],
  },
  {
    tool: "esbuild",
    what: "async generators, `for await` and the symbols they and `using` ask for",
    publishedNames: ["__asyncGenerator", "__await", "__forAwait", "__yieldStar", "__knownSymbol"],
  },
  { tool: "esbuild", what: "`using`", publishedNames: ["__using", "__callDispose"] },
  {
    tool: "bun",
    what: "decorators",
    publishedNames: [
      "__decorateClass",
      "__decorateParam",
      "__legacyDecorateClassTS",
      "__legacyDecorateParamTS",
      "__legacyMetadataTS",
      "__decorateElement",
      "__decoratorContext",
      "__decoratorMetadata",
      "__decoratorStart",
      "__expectFn",
      "__runInitializers",
      "__knownSymbol",
    ],
  },
  { tool: "bun", what: "`using`", publishedNames: ["__using", "__callDispose"] },
  {
    tool: "bun",
    what: "default properties of JSX",
    publishedNames: ["__merge", "__hasAnyProps", "__mergeDefaultProps", "hasAnyProps", "mergeDefaultProps"],
  },
  { tool: "bun", what: "calls of built-ins under a shorter name", publishedNames: ["__jsonParse", "__promiseAll"] },
  {
    tool: "rolldown",
    what: "binary files and `import()` of CommonJS",
    publishedNames: ["__toBinary", "__toBinaryNode", "__toDynamicImportESM"],
  },
];
