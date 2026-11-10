import * as b from "bun-builtins-table";

type UsesByParameter = Readonly<Record<string, readonly b.UseSpec[]>>;

const helpersIn = (file: string, usesByHelper: Readonly<Record<string, UsesByParameter>>) =>
  Object.fromEntries(
    Object.entries(usesByHelper).map(([name, uses]) => [
      name,
      {
        args: Object.fromEntries(Object.keys(uses).map(parameter => [parameter, b.any])),
        returns: b.any,
        capability: "js",
        throws: true,
        runsOnlyOperandCode: false,
        runsUnseenCode: false,
        uses,
        implementation: b.compiled(file, name),
      } satisfies b.FunctionField,
    ]),
  );

// A list that the program makes by its length. The length is converted where it is no number, and the mapper gets what lies at each index and the index.
const newArrayOf = (elements: b.TableType) => b.instance("Array").exactly.holding({ element: elements }).fresh.dense;
const lengthOfNewArray = [b.runs("ToPrimitive")];
const calledForEachIndex = (element: b.PlaceLike, ...others: readonly b.PlaceLike[]) => [
  b.called({
    afterwards: "TouchesOnlyWhatRowNames",
    times: "Repeatedly",
    this: b.undefined,
    args: [element, b.length, ...others],
    result: "Stored",
    resultTo: b.resultSlot("element"),
  }),
];
const arrayMaker = (name: string, returns: b.TableType, uses: UsesByParameter) =>
  ({
    args: Object.fromEntries(Object.keys(uses).map(parameter => [parameter, b.any])),
    returns,
    capability: "js",
    throws: true,
    runsOnlyOperandCode: true,
    runsUnseenCode: false,
    uses,
    implementation: b.compiled("prelude/written-lists", name),
  }) satisfies b.FunctionField;

// Math.max(...list) and Math.min(...list) of a list of numbers. Undefined of anything else, which the call as written gets.
const extremumOfList = (name: string) =>
  ({
    args: { list: b.any },
    returns: b.union(b.f64, b.undefined),
    capability: "js",
    throws: true,
    runsOnlyOperandCode: true,
    runsUnseenCode: false,
    uses: { list: [b.readsContents()] },
    implementation: b.compiled("prelude/written-lists", name),
  }) satisfies b.FunctionField;

// What Array.prototype.sort does with a list and a comparator.
const sortInPlace = (name: string) =>
  ({
    args: { array: b.instance("Array"), comparator: b.callable },
    returns: b.operand("array"),
    capability: "js",
    throws: true,
    runsOnlyOperandCode: true,
    runsUnseenCode: false,
    uses: {
      array: [b.returned, b.readsContents(), b.movesElements],
      comparator: [
        b.called({
          afterwards: "TouchesOnlyWhatRowNames",
          times: "Repeatedly",
          this: b.undefined,
          args: [b.slot("array", "element"), b.slot("array", "element")],
          result: "Escapes",
        }),
      ],
    },
    implementation: b.compiled("prelude/array-sort", name),
  }) satisfies b.FunctionField;

// A helper calls the functions that a list holds, and defines on a class what they return. No word says either.
const calledOrChanged = [b.everything];
const kept = [b.retained];
const usedAsKey = [b.retained, b.runs("ToPrimitive")];

const disposeMethodLookup = (name: string, uses: readonly b.UseSpec[]) =>
  ({
    args: { value: b.any },
    returns: b.union(b.undefined, b.callable),
    capability: "js",
    throws: true,
    runsOnlyOperandCode: true,
    runsUnseenCode: false,
    uses: { value: [...uses, b.runs("PrototypeChain")] },
    implementation: b.compiled("DisposableStackPrototype", name),
  }) satisfies b.FunctionField;

const value = { value: "Value", cppType: "JSC::EncodedJSValue" } as const;
const realm = { value: "Realm", cppType: "JSC::JSGlobalObject*" } as const;

const ownProperties = [
  "ObjectFields",
  "ShapeWords",
  "OrderWords",
  "NamedProperties",
  "Elements",
  "ArrayStorage",
] as const;

const scanOfText = (
  symbol: string,
  minimum: number,
  args: Readonly<Record<string, b.TableType>>,
  parameters: readonly (typeof value | typeof realm)[],
) =>
  ({
    args,
    returns: b.int(minimum, 2 ** 31 - 1),
    capability: "none",
    uses: Object.fromEntries(Object.keys(args).map(name => [name, b.inspected])),
    implementation: b.hostCall,
    directEntry: {
      symbol,
      declaration: `extern "C" SYSV_ABI JSC::EncodedJSValue ${symbol}(${parameters.map(({ cppType }) => cppType).join(", ")});`,
      headers: [],
      parameters,
    },
  }) satisfies b.FunctionField;

const listOfPlainQuery = (symbol: string, element: b.TableType) =>
  ({
    args: { text: b.string, query: b.any },
    returns: b.instance("Array").holding({ element }).fresh.dense,
    capability: "heap",
    uses: { text: b.inspected, query: b.inspected },
    implementation: b.hostCall,
    directEntry: {
      symbol,
      declaration: `extern "C" SYSV_ABI JSC::EncodedJSValue ${symbol}(JSC::JSGlobalObject*, JSC::EncodedJSValue, JSC::EncodedJSValue);`,
      headers: [],
      parameters: [realm, value, value],
    },
  }) satisfies b.FunctionField;

export default b.declarations(
  b.namespace("%CompilerHelpers%", {
    scanPlainQuery: scanOfText("AOT__scanPlainQuery", -1, { text: b.string }, [realm, value]),
    findInPlainQuery: scanOfText("AOT__findInPlainQuery", -2, { text: b.string, name: b.any }, [realm, value, value]),
    plainQueryEntries: listOfPlainQuery(
      "AOT__plainQueryEntries",
      b.instance("Array").holding({ element: b.string }).fresh.dense,
    ),
    plainQueryKeys: listOfPlainQuery("AOT__plainQueryKeys", b.string),
    plainQueryValues: listOfPlainQuery("AOT__plainQueryValues", b.string),
    scanPlainURL: scanOfText("AOT__scanPlainURL", -1, { text: b.string }, [value]),
    scanPlainURLWithPlainBase: scanOfText("AOT__scanPlainURLWithPlainBase", -1, { text: b.string }, [value]),
    scanPlainURLWithBase: scanOfText("AOT__scanPlainURLWithBase", -1, { text: b.string, base: b.any }, [value, value]),
    findPlainQueryValue: scanOfText("AOT__findPlainQueryValue", -2, { text: b.string, offsets: b.any, name: b.any }, [
      value,
      value,
      value,
    ]),
    // Object.entries(object) for a loop that takes each pair apart at once: the keys and values one behind the other in one list.
    ownEntriesFlat: {
      args: { object: b.any },
      returns: b.instance("Array").fresh.dense,
      capability: "js",
      throws: true,
      runsOnlyOperandCode: true,
      runsUnseenCode: false,
      uses: { object: [b.runs("OwnKeys", "OwnValues"), b.contentsStoredIn(b.resultSlot("element"))] },
      writes: ["ShapeWords", "NamedProperties", "MemberGuards", "ObjectFields"],
      implementation: b.hostCall,
      directEntry: {
        symbol: "AOT__ownEntriesFlat",
        declaration:
          'extern "C" SYSV_ABI JSC::EncodedJSValue AOT__ownEntriesFlat(JSC::JSGlobalObject*, JSC::EncodedJSValue);',
        headers: [],
        parameters: [
          { value: "Realm", cppType: "JSC::JSGlobalObject*" },
          { value: "Value", cppType: "JSC::EncodedJSValue" },
        ],
      },
    },
    // Object.defineProperties(target, Object.getOwnPropertyDescriptors(source)) where the call alone has the descriptors, in two halves, each where its call stood: an error comes from where it came from.
    // describeUnlessOrdinary converts and refuses the source, and does what somebody may see of its description.
    describeUnlessOrdinary: {
      args: { source: b.any },
      returns: b.object,
      capability: "js",
      throws: true,
      runsOnlyOperandCode: true,
      runsUnseenCode: false,
      uses: { source: [b.returned, ...b.ownPropertyTraps] },
      reads: ownProperties,
      implementation: b.hostCall,
      directEntry: {
        symbol: "AOT__describeUnlessOrdinary",
        declaration:
          'extern "C" SYSV_ABI JSC::EncodedJSValue AOT__describeUnlessOrdinary(JSC::JSGlobalObject*, JSC::EncodedJSValue);',
        headers: [],
        parameters: [realm, value],
      },
    },
    // definePropertiesFrom takes what that answers, refuses what is no target, and defines each own property of an ordinary source on the target as it stands: no object describes it on the way.
    definePropertiesFrom: {
      args: { target: b.any, described: b.object, source: b.any },
      returns: b.operand("target"),
      capability: "js",
      throws: true,
      runsOnlyOperandCode: true,
      runsUnseenCode: false,
      uses: {
        target: [b.returned, b.definedFrom("source"), ...b.ownPropertyTraps],
        described: b.inspected,
        source: b.inspected,
      },
      reads: ownProperties,
      writes: ["MemberGuards"],
      implementation: b.hostCall,
      directEntry: {
        symbol: "AOT__definePropertiesFrom",
        declaration:
          'extern "C" SYSV_ABI JSC::EncodedJSValue AOT__definePropertiesFrom(JSC::JSGlobalObject*, JSC::EncodedJSValue, JSC::EncodedJSValue, JSC::EncodedJSValue);',
        headers: [],
        parameters: [realm, value, value, value],
      },
    },
    // `[...items]`, `f(...items)`: what the iteration hands out goes behind the elements of the list that the spread fills.
    appendIterable: {
      args: { target: b.instance("Array"), items: b.any },
      returns: b.undefined,
      capability: "js",
      throws: true,
      runsOnlyOperandCode: true,
      runsUnseenCode: false,
      uses: {
        target: [b.readsContents(), b.writesContents()],
        items: [b.runs("Iterate"), b.iteratedValuesStoredIn(b.slot("target", "element"))],
      },
      implementation: b.compiled("prelude/iterator-consumers", "appendIterable"),
    },
    appendGenerator: {
      args: { target: b.instance("Array"), items: b.any },
      returns: b.undefined,
      capability: "js",
      throws: true,
      runsOnlyOperandCode: true,
      runsUnseenCode: false,
      uses: {
        target: [b.readsContents(), b.writesContents()],
        items: [b.runs("Iterate"), b.iteratedValuesStoredIn(b.slot("target", "element"))],
      },
      implementation: b.compiled("prelude/iterator-consumers", "appendGenerator"),
    },
    takeFromIterable: {
      args: { items: b.any, count: b.any },
      returns: b.instance("Array").holding({ element: b.iterated("items") }).fresh,
      capability: "js",
      throws: true,
      runsOnlyOperandCode: true,
      runsUnseenCode: false,
      uses: { items: [b.runs("Iterate"), b.iteratedValuesStoredIn(b.resultSlot("element"))], count: b.inspected },
      implementation: b.compiled("prelude/iterator-consumers", "takeFromIterable"),
    },
    nextOfStepsOverText: {
      args: {},
      returns: b.any,
      capability: "js",
      throws: true,
      runsOnlyOperandCode: false,
      runsUnseenCode: false,
      uses: { this: calledOrChanged },
      implementation: b.compiled("prelude/iterator-consumers", "nextOfStepsOverText"),
    },
    importRejectedByLoader: {
      args: { reason: b.any },
      returns: b.instance("Promise").holding({ value: b.never }).fresh,
      capability: "js",
      throws: false,
      runsOnlyOperandCode: true,
      runsUnseenCode: false,
      // As the reason of Promise.reject: the host hands it to the listeners for unhandled rejections.
      uses: { reason: [b.storedIn(b.resultSlot("reason")), b.retained] },
      implementation: b.compiled("prelude/rejected-imports", "importRejectedByLoader"),
    },
    askRunOfTestFile: {
      args: { ownGlobals: b.bool },
      returns: b.f64,
      capability: "none",
      uses: { ownGlobals: b.inspected },
      implementation: b.compiled("prelude/test-files", "askRunOfTestFile"),
    },
    ...helpersIn("prelude/decorators", {
      decorateClass: { decorators: calledOrChanged, target: calledOrChanged },
      decorateMethod: { decorators: calledOrChanged, target: calledOrChanged, key: usedAsKey },
      decorateProperty: { decorators: calledOrChanged, target: calledOrChanged, key: usedAsKey },
      decorateParameter: {
        index: kept,
        decorator: [
          b.retained,
          b.called({
            afterwards: "TouchesOnlyWhatRowNames",
            times: "Later",
            this: b.undefined,
            args: [],
            spreadArgs: b.any,
            result: "Escapes",
          }),
        ],
      },
      defineMetadata: { key: kept, value: kept },
      createDecoratorMetadata: { base: calledOrChanged },
      setDecoratorMetadata: { target: calledOrChanged, metadata: kept },
      createElement: { kind: kept, name: kept, isStatic: kept, isPrivate: kept },
      createPrivateStorage: { test: kept, get: kept, set: kept },
      applyClassDecorators: {
        decorators: calledOrChanged,
        target: calledOrChanged,
        name: kept,
        metadata: calledOrChanged,
        initializers: calledOrChanged,
      },
      applyMethodDecorators: {
        decorators: calledOrChanged,
        holder: calledOrChanged,
        element: calledOrChanged,
        metadata: calledOrChanged,
        initializers: calledOrChanged,
      },
      applyPrivateMethodDecorators: {
        decorators: calledOrChanged,
        value: calledOrChanged,
        element: calledOrChanged,
        test: calledOrChanged,
        metadata: calledOrChanged,
        initializers: calledOrChanged,
      },
      applyFieldDecorators: {
        decorators: calledOrChanged,
        element: calledOrChanged,
        metadata: calledOrChanged,
        valueInitializers: calledOrChanged,
        extraInitializers: calledOrChanged,
      },
      applyPrivateFieldDecorators: {
        decorators: calledOrChanged,
        element: calledOrChanged,
        storage: calledOrChanged,
        metadata: calledOrChanged,
        valueInitializers: calledOrChanged,
        extraInitializers: calledOrChanged,
      },
      applyAccessorDecorators: {
        decorators: calledOrChanged,
        holder: calledOrChanged,
        element: calledOrChanged,
        metadata: calledOrChanged,
        valueInitializers: calledOrChanged,
        extraInitializers: calledOrChanged,
      },
      applyPrivateAccessorDecorators: {
        decorators: calledOrChanged,
        element: calledOrChanged,
        storage: calledOrChanged,
        metadata: calledOrChanged,
        valueInitializers: calledOrChanged,
        extraInitializers: calledOrChanged,
      },
      runInitializers: { initializers: calledOrChanged, receiver: calledOrChanged },
      runValueInitializers: { initializers: calledOrChanged, receiver: calledOrChanged, value: calledOrChanged },
    }),
    maxOfList: extremumOfList("maxOfList"),
    minOfList: extremumOfList("minOfList"),
    checkedArrayLength: arrayMaker("checkedArrayLength", b.operand("length"), { length: [b.returned] }),
    // The front end writes arrayOfUndefined where the mapper is undefined, so this one never gets that.
    arrayFromLength: arrayMaker("arrayFromLength", newArrayOf(b.callbackResult("mapper")), {
      length: lengthOfNewArray,
      mapper: calledForEachIndex(b.undefined),
    }),
    // What is no list after all goes to Array.from, so the row says of both operands what that of Array.from says.
    arrayFromList: arrayMaker("arrayFromList", newArrayOf(b.callbackResult("mapper")), {
      list: [b.runs("Iterate", "OwnValues", "PrototypeChain", "ToPrimitive", b.named("length"))],
      mapper: [...calledForEachIndex(b.iterated("list")), ...calledForEachIndex(b.ownValues("list"))],
    }),
    arrayOfUndefined: arrayMaker("arrayOfUndefined", newArrayOf(b.undefined), { length: lengthOfNewArray }),
    filledArray: arrayMaker("filledArray", newArrayOf(b.operand("value")), {
      length: b.inspected,
      value: [b.storedIn(b.resultSlot("element"))],
    }),
    mappedFilledArray: arrayMaker("mappedFilledArray", newArrayOf(b.callbackResult("mapper")), {
      length: b.inspected,
      value: b.inspected,
      // Where the length is no small number the list is filled and mapped as the program wrote it, and the mapper gets that list too.
      mapper: calledForEachIndex(b.operand("value"), b.instance("Array")),
    }),
    sortByDifference: sortInPlace("sortByDifference"),
    sortByReversedDifference: sortInPlace("sortByReversedDifference"),
    // The protocol of iteration, for a loop over a value of which the engine knows nothing. The engine calls the functions directly, and goes by what their code does.
    ...helpersIn("prelude/iterator-consumers", {
      openIterator: { iterable: calledOrChanged },
      openWrappedIterator: { iterable: calledOrChanged },
      stepIterator: { iterator: calledOrChanged, next: calledOrChanged },
      wayToStepIterator: { iterator: calledOrChanged, next: calledOrChanged },
      stepIteratorInWay: { iterator: calledOrChanged, way: calledOrChanged },
      closeIterator: { iterator: calledOrChanged },
      closeIteratorAfterThrow: { iterator: calledOrChanged },
    }),
    getDisposeMethod: disposeMethodLookup("getDisposeMethod", [b.readByKey(b.keysNamed("@@dispose"))]),
    getAsyncDisposeMethod: disposeMethodLookup("getAsyncDisposeMethod", [
      b.readByKey(b.keysNamed("@@asyncDispose", "@@dispose")),
      b.retained,
    ]),
  }),
);
