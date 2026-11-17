import * as b from "bun-builtins-table";

export const retainedByNativeCode = b.retainedByNativeCode;
// Native code of which the table says what it answers and nothing else: it may do with its operands whatever native code can.
export const constructing = (returns: b.TableType, implementation: typeof b.generic = b.generic) =>
  ({
    args: { operands: b.any.rest },
    returns,
    capability: "js",
    throws: true,
    uses: { operands: [b.everything] },
    implementation,
  }) satisfies b.FunctionField;
export const answering = (returns: b.TableType, implementation: typeof b.generic = b.generic) =>
  ({
    ...constructing(returns, implementation),
    this: b.any,
    uses: { this: [b.everything], operands: [b.everything] },
  }) satisfies b.FunctionField;
export const promiseOf = (value: b.TableType) => b.instance("Promise").holding({ value, reason: b.any });
const protocolsOfDeepComparison = ["OwnKeys", "OwnValues", "PrototypeChain", "ToPrimitive", b.named()] as const;
// A key of one operand is read from the other under that name, through its prototypes, so any member may be read.
export const comparedDeeply = [b.readsContents(), b.runsTransitively(...protocolsOfDeepComparison)];
// Bun__deepMatch() in bindings.cpp lists private names too, at every object that it comes to.
export const matchedDeeply = [...comparedDeeply, b.privateFieldsCompared];
export const comparedDeeplyCalling = (...members: readonly string[]) => [
  b.readsContents(),
  b.runsTransitively(...protocolsOfDeepComparison, b.calls(...members)),
];
export const deepComparison = (
  args: Readonly<Record<string, b.TableType>>,
  uses: Readonly<Record<string, readonly b.UseSpec[]>>,
) =>
  ({
    args,
    returns: b.bool,
    capability: "js",
    throws: true,
    runsOnlyOperandCode: true,
    uses,
    reads: [
      "TypedArrayStorage",
      "TypedArrayElements",
      "CollectionStorage",
      "CollectionEntries",
      "InternalFields",
      "ExternalState",
    ],
    implementation: b.hostCall,
  }) satisfies b.FunctionField;
// While an async context is set, native code keeps a callback inside a wrapper of its own, and a getter that answers what is kept hands out the wrapper: an object that no script has made.
export const mayAnswerWrapperKeptIn = (cell: string) => b.createdIn(b.object, b.nativeCell(cell));
