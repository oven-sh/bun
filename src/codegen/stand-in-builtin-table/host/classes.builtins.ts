import * as b from "bun-builtins-table";

const arrayBufferView = b.union(b.instance("TypedArray"), b.instance("DataView"));
const anyArrayBuffer = b.union(b.instance("ArrayBuffer"), b.instance("SharedArrayBuffer"));
const converted = [b.runs("ToPrimitive")];
const madeOfAnything = (name: string) =>
  ({
    args: { operands: b.any.rest },
    returns: b.instance(name).fresh,
    capability: "js",
    throws: true,
    uses: { operands: [b.everything] },
    implementation: b.generic,
  }) satisfies b.FunctionField;

const readsState = [b.readsContents()];
const component = {
  getter: b.string,
  capability: "heap",
  uses: { this: readsState },
  implementation: b.hostCall,
} satisfies b.FunctionField;
const askedByName = (returns: b.TableType) =>
  ({
    args: { name: b.string },
    returns,
    capability: "heap",
    uses: { this: readsState },
    implementation: b.hostCall,
  }) satisfies b.FunctionField;
const listed = {
  returns: b.object.fresh,
  capability: "heap",
  uses: { this: [b.retained] },
  implementation: b.hostCall,
} satisfies b.FunctionField;

export default b.declarations(
  b.class("File", { call: madeOfAnything("File"), construct: madeOfAnything("File") }),
  b.class("URL", {
    call: madeOfAnything("URL"),
    construct: madeOfAnything("URL"),
    proto: {
      pathname: component,
      search: component,
      searchParams: { ...component, getter: b.instance("URLSearchParams") },
    },
  }),
  b.class("URLSearchParams", {
    call: madeOfAnything("URLSearchParams"),
    construct: madeOfAnything("URLSearchParams"),
    proto: {
      entries: listed,
      keys: listed,
      values: listed,
      get: askedByName(b.union(b.string, b.null)),
      has: askedByName(b.bool),
      size: { ...component, getter: b.u32 },
      toString: { returns: b.string, capability: "heap", uses: { this: readsState }, implementation: b.hostCall },
    },
  }),
  b.class("TextEncoder", {
    call: madeOfAnything("TextEncoder"),
    construct: madeOfAnything("TextEncoder"),
    proto: {
      encode: {
        args: { input: b.string.optional },
        returns: b.instance("Uint8Array").exactly.fresh,
        capability: "heap",
        throws: true,
        uses: { this: b.inspected },
        implementation: b.hostCall,
      },
      encodeInto: {
        args: { source: b.string, destination: b.instance("Uint8Array") },
        returns: b.object.fresh,
        capability: "heap",
        throws: true,
        uses: { this: b.inspected, destination: [b.writesContents()] },
        implementation: b.hostCall,
      },
    },
  }),
  b.namespace("Bun", {
    serve: {
      args: { options: b.object },
      returns: b.object.fresh,
      capability: "js",
      throws: true,
      runsUnseenCode: b.whenOperandHasProperty("options", "app"),
      uses: {
        options: [
          b.runsTransitively(b.named("fetch", "websocket", "message", "close")),
          b.memberCalled(["fetch"], { times: "PerEvent", this: b.undefined, args: [b.any, b.result], result: "Escapes" }),
          b.memberCalled(["websocket", "message"], { times: "PerEvent", this: b.undefined, args: [b.any, b.any], result: "Ignored" }),
          b.memberCalled(["websocket", "close"], { times: "PerEvent", this: b.undefined, args: [b.any, b.any, b.any], result: "Ignored" }),
        ],
      },
      implementation: b.hostCall,
    },
  }),
  b.namespace("Bun.FFI", {}),
  b.namespace("%JSONText%", {}),
  b.namespace("%bun:bundle%", {
    feature: {
      args: { flag: b.string },
      returns: b.bool,
      capability: "none",
      throws: true,
      implementation: b.generic,
    },
  }),
  b.namespace("%NativeFunctions%", {}),
  b.class("Buffer", {
    extends: "Uint8Array",
    jsType: "Uint8ArrayType",
    isNeverPristine: true,
    pristineTest: "InstanceStructure",
    instanceStructureCppExpression: "nullptr",
    types: [b.exactType("Buffer")],
    call: madeOfAnything("Buffer"),
    construct: madeOfAnything("Buffer"),
    static: {
      byteLength: [
        {
          args: { string: b.string, encoding: b.any.optional },
          returns: b.int(0, 3 * (2 ** 31 - 1)),
          capability: "heap",
          throws: true,
          uses: { string: [b.readAsCharacters], encoding: b.inspected },
          implementation: b.inline("StringUTF8ByteLength", { otherwise: b.hostCall }),
        },
        {
          args: { bytes: b.union(arrayBufferView, anyArrayBuffer) },
          returns: b.int(0, b.checked(2 ** 32, "MAX_ARRAY_BUFFER_SIZE")),
          capability: "none",
          uses: { bytes: b.inspected },
          reads: ["TypedArrayStorage"],
          implementation: b.hostCall,
        },
      ],
    },
    proto: {
      toString: {
        this: b.instance("Uint8Array"),
        args: { encoding: b.any.optional, start: b.any.optional, end: b.any.optional },
        returns: b.string,
        capability: "js",
        throws: true,
        runsOnlyOperandCode: true,
        uses: { this: [b.readsContents()], encoding: converted, start: converted, end: converted },
        implementation: b.hostCall,
      },
    },
  }),
);
