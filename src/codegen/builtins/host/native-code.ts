import * as b from "bun-builtins-table";

export const handedOver = b.handedOver;
export const objectHandedOver = handedOver;
// While an async context is set, native code keeps a callback inside a wrapper of its own, and a getter that answers what is kept hands out the wrapper: an object that no script has made.
export const mayAnswerWrapperKeptIn = (cell: string) => b.createdIn(b.object, b.nativeCell(cell));
