import * as b from "bun-builtins-table";

export const handedOver = b.handedOver;
export const objectHandedOver = handedOver;
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
// While an async context is set, native code keeps a callback inside a wrapper of its own, and a getter that answers what is kept hands out the wrapper: an object that no script has made.
export const mayAnswerWrapperKeptIn = (cell: string) => b.createdIn(b.object, b.nativeCell(cell));
