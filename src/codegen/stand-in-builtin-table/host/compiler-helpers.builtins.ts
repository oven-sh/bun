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
const newArrayOf = (elements: b.TableType) => b.instance("Array").holding({ element: elements }).fresh;
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

// A helper calls the functions that a list holds, and defines on a class what they return. No word says either.
const calledOrChanged = [b.everything];
const kept = [b.retained];
const keptWithContents = [b.retained, b.contentsStoredIn(b.nativeMemory)];
const usedAsKey = [b.retained, b.runs("ToPrimitive")];
// The compiler writes a number here. Anything else would be compared with one.
const comparedWithNumbers = [b.runsTransitively("OwnValues", "PrototypeChain", "ToPrimitive", b.named("length"))];

const disposeMethodLookup = (name: string, uses: readonly b.UseSpec[]) =>
  ({
    args: { value: b.any },
    returns: b.union(b.undefined, b.callable),
    capability: "js",
    throws: true,
    runsOnlyOperandCode: true,
    runsUnseenCode: false,
    uses: { value: uses },
    implementation: b.compiled("DisposableStackPrototype", name),
  }) satisfies b.FunctionField;

const ownProperties = [
  "ObjectFields",
  "ShapeWords",
  "OrderWords",
  "NamedProperties",
  "Elements",
  "ArrayStorage",
] as const;

// Object.defineProperties(target, Object.getOwnPropertyDescriptors(source)) where the call alone has the descriptors, in two halves, each where its call stood: an error comes from where it came from. describeUnlessOrdinary converts and refuses the source, and does what somebody may see of its description. definePropertiesFrom takes what that answers, refuses what is no target, and defines each own property of an ordinary source on the target as it stands: no object describes it on the way.
const definitionFrom = {
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
    parameters: [
      { value: "Realm", cppType: "JSC::JSGlobalObject*" },
      { value: "Value", cppType: "JSC::EncodedJSValue" },
      { value: "Value", cppType: "JSC::EncodedJSValue" },
      { value: "Value", cppType: "JSC::EncodedJSValue" },
    ],
  },
} satisfies b.FunctionField;

const value = { value: "Value", cppType: "JSC::EncodedJSValue" } as const;
const realm = { value: "Realm", cppType: "JSC::JSGlobalObject*" } as const;

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
        parameters: [
          { value: "Realm", cppType: "JSC::JSGlobalObject*" },
          { value: "Value", cppType: "JSC::EncodedJSValue" },
        ],
      },
    },
    definePropertiesFrom: definitionFrom,
    ...helpersIn("prelude/decorators", {
      decorateClass: { decorators: calledOrChanged, target: calledOrChanged },
      decorateMethod: { decorators: calledOrChanged, target: calledOrChanged, key: usedAsKey },
      decorateProperty: { decorators: calledOrChanged, target: calledOrChanged, key: usedAsKey },
      decorateParameter: {
        index: kept,
        decorator: [b.retained, b.called({ afterwards: "TouchesOnlyWhatRowNames", times: "Later", this: b.undefined, args: [], spreadArgs: b.any, result: "Escapes" })],
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
    checkedArrayLength: arrayMaker("checkedArrayLength", b.operand("length"), { length: [b.returned] }),
    // The front end writes arrayOfUndefined where the mapper is undefined, so this one never gets that.
    arrayFromLength: arrayMaker("arrayFromLength", newArrayOf(b.callbackResult("mapper")), {
      length: lengthOfNewArray,
      mapper: calledForEachIndex(b.undefined),
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
    ...helpersIn("prelude/array-traversal", {
      traverseArray: {
        array: keptWithContents,
        start: comparedWithNumbers,
        end: comparedWithNumbers,
        shape: comparedWithNumbers,
        operands: keptWithContents,
        operand: [b.retained, b.returned],
      },
    }),
    getDisposeMethod: disposeMethodLookup("getDisposeMethod", [b.readByKey(b.keysNamed("@@dispose"))]),
    getAsyncDisposeMethod: disposeMethodLookup("getAsyncDisposeMethod", [
      b.readByKey(b.keysNamed("@@asyncDispose", "@@dispose")),
      b.retained,
    ]),
  }),
);
