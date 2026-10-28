import * as b from "bun-builtins-table";
import { handedOver } from "./native-code.ts";

type ParameterList = Readonly<Record<string, b.TableType>>;

const viewHeaps = ["TypedArrayStorage", "TypedArrayElements"];

const maximumLength = b.checked(2 ** 32, "MAX_ARRAY_BUFFER_SIZE");
const byteCount = b.int(0, maximumLength);
const comparison = b.int(-1, 1);

const uint8Array = b.instance("Uint8Array");
const arrayBufferView = b.union(b.instance("TypedArray"), b.instance("DataView"));
const anyArrayBuffer = b.union(b.instance("ArrayBuffer"), b.instance("SharedArrayBuffer"));
const newBuffer = b.instance("Buffer").fresh;
const bufferOverSharedBytes = b.instance("Buffer");
const positionOrEncoding = b.union(b.f64, b.string).optional;

const readsBytes = [b.readsContents()];
const writesBytes = [b.readsContents(), b.writesContents()];
const converted = [b.runs("ToPrimitive")];
const readAsArrayLike = b.runs("OwnValues", "PrototypeChain", "ToPrimitive", b.named("length"));

// ERR_INVALID_ARG_VALUE prints the value with Bun.inspect, which prints what a custom inspect function returns.
const printedByInspect = b.printedByFormatter();

const fromInJavaScript = b.compiled("builtins/JSBufferConstructor", "from");

const createdFrom = (implementation: b.ImplementationSpec): b.FunctionField[] => [
  {
    args: { string: b.string, encoding: b.any.optional },
    returns: newBuffer,
    capability: "heap",
    throws: true,
    uses: { string: [b.readAsCharacters], encoding: b.inspected },
    implementation,
  },
  {
    args: { arrayBuffer: anyArrayBuffer, byteOffset: b.any.optional, length: b.any.optional },
    returns: bufferOverSharedBytes,
    capability: "js",
    throws: true,
    runsOnlyOperandCode: true,
    uses: { arrayBuffer: [b.retained, b.readsContents()], byteOffset: converted, length: converted },
    implementation,
  },
  {
    args: { typedArray: b.instance("TypedArray") },
    returns: newBuffer,
    capability: "heap",
    throws: true,
    uses: { typedArray: readsBytes },
    implementation,
  },
];

const constructed: b.FunctionField[] = [
  {
    args: { value: b.notPassed },
    returns: newBuffer,
    capability: "heap",
    implementation: b.hostCall,
  },
  {
    args: { size: b.f64, encoding: b.any.optional },
    returns: newBuffer,
    capability: "heap",
    throws: true,
    uses: { encoding: b.inspected },
    implementation: b.hostCall,
  },
  ...createdFrom(b.hostCall),
  // Of any other object it makes the bytes as `new Uint8Array(value)` does: it goes over an iterable, or reads `length` and the elements, and makes a number of each.
  {
    args: { value: b.any, encoding: b.any.optional },
    returns: newBuffer,
    capability: "js",
    throws: true,
    runsOnlyOperandCode: true,
    uses: {
      value: [
        ...handedOver,
        b.runsTransitively("Iterate", "OwnValues", "PrototypeChain", "ToPrimitive", b.named("length")),
      ],
      encoding: [...handedOver, b.runs("ToPrimitive")],
    },
    implementation: b.hostCall,
  },
];

const uninitialized = {
  args: { size: b.f64 },
  returns: newBuffer,
  capability: "heap",
  throws: true,
  implementation: b.hostCall,
} satisfies b.FunctionField;

const search = (returns: b.TableType) =>
  ({
    this: uint8Array,
    args: {
      value: b.union(b.f64, b.string, uint8Array),
      byteOffset: b.any.optional,
      end: b.any.optional,
      encoding: b.any.optional,
    },
    returns,
    capability: "js",
    throws: true,
    runsOnlyOperandCode: true,
    uses: { this: readsBytes, value: readsBytes, byteOffset: converted, end: converted, encoding: converted },
    implementation: b.hostCall,
  }) satisfies b.FunctionField;

const byteSwap = {
  this: uint8Array,
  returns: b.operand("this"),
  capability: "none",
  throws: true,
  uses: { this: writesBytes },
  implementation: b.hostCall,
} satisfies b.FunctionField;

const sharedRange = {
  this: uint8Array,
  args: { start: b.f64.loose.optional, end: b.f64.loose.optional },
  returns: bufferOverSharedBytes,
  capability: "heap",
  throws: true,
  readsStateBeforeConversions: true,
  uses: { this: [b.retained, ...writesBytes] },
  implementation: b.hostCall,
} satisfies b.FunctionField;

const decodedRange = {
  this: arrayBufferView,
  args: { start: b.any.optional, end: b.any.optional },
  returns: b.string,
  capability: "js",
  throws: true,
  runsOnlyOperandCode: true,
  uses: { this: readsBytes, start: converted, end: converted },
  implementation: b.hostCall,
} satisfies b.FunctionField;

const encodedWrite = {
  this: arrayBufferView,
  args: { string: b.string, offset: b.any.optional, length: b.any.optional },
  returns: byteCount,
  capability: "js",
  throws: true,
  runsOnlyOperandCode: true,
  uses: { this: writesBytes, string: [b.readAsCharacters], offset: converted, length: converted },
  implementation: b.hostCall,
} satisfies b.FunctionField;

const numberRead = (args: ParameterList, returns: b.TableType) =>
  ({
    this: arrayBufferView,
    args,
    returns,
    capability: "heap",
    throws: true,
    uses: { this: readsBytes },
    implementation: b.hostCall,
  }) satisfies b.FunctionField;

const atOptionalOffset: ParameterList = { offset: b.f64.optional };
const atOffsetWithWidth: ParameterList = { offset: b.f64, byteLength: b.f64 };
const signedWithWidth = numberRead(atOffsetWithWidth, b.int(-(2 ** 47), 2 ** 47 - 1));
const unsignedWithWidth = numberRead(atOffsetWithWidth, b.int(0, 2 ** 48 - 1));

const numberWrite = (width: number) =>
  ({
    this: arrayBufferView,
    args: { value: b.f64.loose, offset: b.f64.optional },
    returns: b.int(width, maximumLength),
    capability: "heap",
    throws: true,
    uses: { this: writesBytes },
    implementation: b.hostCall,
  }) satisfies b.FunctionField;

const numberWriteWithWidth = {
  this: arrayBufferView,
  args: { value: b.any, offset: b.f64, byteLength: b.f64 },
  returns: b.int(1, maximumLength),
  capability: "js",
  throws: true,
  runsOnlyOperandCode: true,
  uses: { this: writesBytes, value: converted },
  implementation: b.hostCall,
} satisfies b.FunctionField;

const propertyOfBuffer = (name: string, property: string) =>
  ({
    this: b.any,
    getter: b.any,
    capability: "js",
    throws: true,
    uses: { this: [b.runs("PrototypeChain"), b.readByKey(b.keysNamed(property))] },
    implementation: b.compiled("builtins/JSBufferPrototype", name),
  }) satisfies b.GetterField;

// `new Buffer.from(..)` runs the same function, and what that answers takes the place of the new object.
const createdByFrom: b.FunctionField[] = [
  ...createdFrom(fromInJavaScript),
  {
    args: { array: b.instance("Array").pristine("Names") },
    returns: newBuffer,
    capability: "js",
    throws: true,
    runsOnlyOperandCode: true,
    uses: { array: [b.readsContents(), b.runsTransitively("OwnValues", "ToPrimitive")] },
    constructable: true,
    implementation: fromInJavaScript,
  },
  // Whatever way it takes, it ends in `new Buffer(..)` or throws. The bytes may be those of an ArrayBuffer that valueOf of the operand answers.
  {
    args: { value: b.any.optional, encodingOrOffset: b.any.optional, length: b.any.optional },
    returns: b.instance("Buffer"),
    capability: "js",
    throws: true,
    uses: { value: handedOver, encodingOrOffset: handedOver, length: handedOver },
    implementation: fromInJavaScript,
  },
];

export default b.declarations(
  b.constructionOfFunction("Buffer.from", createdByFrom),
  b.class("Buffer", {
    extends: "Uint8Array",
    jsType: "Uint8ArrayType",
    isNeverPristine: true,
    pristineTest: "InstanceStructure",
    instanceStructureCppExpression: "globalObject->m_JSBufferSubclassStructure.getConcurrently()",
    lockedMembers: ["constructor", "prototype"],
    types: [b.exactType("Buffer")],
    constructorTable: b.staticTable("src/jsc/bindings/JSBuffer.cpp", "jsBufferConstructorTable"),
    call: constructed,
    construct: constructed,
    static: {
      poolSize: b.property(b.f64, { mutability: "ConstantUnlessWritten" }),
      alloc: [
        {
          args: { size: b.f64, fill: b.undefined.optional },
          returns: newBuffer,
          capability: "heap",
          throws: true,
          implementation: b.hostCall,
        },
        {
          args: { size: b.f64, fill: arrayBufferView, encoding: b.any.optional },
          returns: newBuffer,
          capability: "js",
          throws: true,
          runsOnlyOperandCode: true,
          uses: { fill: [b.readsContents(), printedByInspect], encoding: b.inspected },
          implementation: b.hostCall,
        },
        {
          args: { size: b.f64, fill: b.any, encoding: b.any.optional },
          returns: newBuffer,
          capability: "js",
          throws: true,
          runsOnlyOperandCode: true,
          uses: { fill: converted, encoding: converted },
          implementation: b.hostCall,
        },
      ],
      allocUnsafe: uninitialized,
      allocUnsafeSlow: uninitialized,
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
          returns: byteCount,
          capability: "none",
          uses: { bytes: b.inspected },
          reads: ["TypedArrayStorage"],
          implementation: b.hostCall,
        },
      ],
      compare: {
        args: { buf1: arrayBufferView, buf2: arrayBufferView },
        returns: comparison,
        capability: "none",
        uses: { buf1: readsBytes, buf2: readsBytes },
        implementation: b.hostCall,
      },
      concat: [
        {
          args: {
            list: b.instance("Array").holding({ element: uint8Array }).pristine("Storage"),
            totalLength: b.f64.optional,
          },
          returns: newBuffer,
          capability: "heap",
          throws: true,
          uses: { list: [b.readsContents()] },
          reads: viewHeaps,
          implementation: b.hostCall,
        },
        {
          args: { list: b.object, totalLength: b.f64.optional },
          returns: newBuffer,
          capability: "js",
          throws: true,
          runsOnlyOperandCode: true,
          uses: { list: [b.readsContents(), readAsArrayLike] },
          reads: viewHeaps,
          implementation: b.hostCall,
        },
      ],
      copyBytesFrom: {
        args: { view: arrayBufferView, offset: b.f64.optional, length: b.f64.optional },
        returns: newBuffer,
        capability: "heap",
        throws: true,
        uses: { view: readsBytes },
        implementation: b.hostCall,
      },
      from: createdByFrom,
      isBuffer: {
        args: { value: b.any },
        returns: b.bool,
        capability: "js",
        throws: true,
        uses: { value: [b.runs("PrototypeChain")] },
        implementation: b.compiled("builtins/JSBufferConstructor", "isBuffer"),
      },
      isEncoding: {
        args: { encoding: b.any },
        returns: b.bool,
        capability: "heap",
        uses: { encoding: b.inspected },
        implementation: b.hostCall,
      },
    },
    proto: {
      parent: propertyOfBuffer("parent", "buffer"),
      offset: propertyOfBuffer("offset", "byteOffset"),
      compare: {
        this: uint8Array,
        args: {
          target: uint8Array,
          targetStart: b.f64.optional,
          targetEnd: b.f64.optional,
          sourceStart: b.f64.optional,
          sourceEnd: b.f64.optional,
        },
        returns: comparison,
        capability: "none",
        throws: true,
        uses: { this: readsBytes, target: readsBytes },
        implementation: b.hostCall,
      },
      copy: {
        this: uint8Array,
        args: {
          target: arrayBufferView,
          targetStart: b.any.optional,
          sourceStart: b.any.optional,
          sourceEnd: b.any.optional,
        },
        returns: byteCount,
        capability: "js",
        throws: true,
        runsOnlyOperandCode: true,
        uses: {
          this: readsBytes,
          target: writesBytes,
          targetStart: converted,
          sourceStart: converted,
          sourceEnd: converted,
        },
        implementation: b.hostCall,
      },
      equals: {
        this: uint8Array,
        args: { otherBuffer: arrayBufferView },
        returns: b.bool,
        capability: "none",
        uses: { this: readsBytes, otherBuffer: readsBytes },
        implementation: b.hostCall,
      },
      fill: {
        this: uint8Array,
        args: { value: b.any.optional, offset: positionOrEncoding, end: positionOrEncoding, encoding: b.any.optional },
        returns: b.operand("this"),
        capability: "js",
        throws: true,
        runsOnlyOperandCode: true,
        uses: {
          this: writesBytes,
          value: [b.readsContents(), b.runs("ToPrimitive")],
          encoding: converted,
        },
        reads: viewHeaps,
        implementation: b.hostCall,
      },
      includes: search(b.bool),
      indexOf: search(b.int(-1, maximumLength)),
      lastIndexOf: search(b.int(-1, maximumLength)),
      inspect: b.otherwise,
      slice: sharedRange,
      subarray: sharedRange,
      swap16: byteSwap,
      swap32: byteSwap,
      swap64: byteSwap,
      // { type: "Buffer", data: Array.from(this) }, whatever `this` is. Array.from throws for undefined and null before it does anything else.
      toJSON: {
        this: b.any.refusing(b.null),
        returns: b.object.fresh,
        capability: "js",
        throws: true,
        runsOnlyOperandCode: true,
        uses: {
          this: [
            b.readsContents(),
            b.runs("Iterate", "OwnValues", "PrototypeChain", "ToPrimitive", b.named("length")),
            b.contentsStoredIn(b.nativeMemory),
            b.iteratedValuesStoredIn(b.nativeMemory),
          ],
        },
        reads: viewHeaps,
        implementation: b.compiled("builtins/JSBufferPrototype", "toJSON"),
      },
      toString: {
        this: uint8Array,
        args: { encoding: b.any.optional, start: b.any.optional, end: b.any.optional },
        returns: b.string,
        capability: "js" as const,
        throws: true,
        runsOnlyOperandCode: true,
        uses: { this: readsBytes, encoding: converted, start: converted, end: converted },
        implementation: b.hostCall,
      },
      write: {
        this: uint8Array,
        args: { string: b.string, offset: positionOrEncoding, length: positionOrEncoding, encoding: b.any.optional },
        returns: byteCount,
        capability: "js",
        throws: true,
        runsOnlyOperandCode: true,
        uses: { this: writesBytes, string: [b.readAsCharacters], encoding: converted },
        implementation: b.hostCall,
      },
      asciiSlice: decodedRange,
      base64Slice: decodedRange,
      base64urlSlice: decodedRange,
      hexSlice: decodedRange,
      latin1Slice: decodedRange,
      ucs2Slice: decodedRange,
      utf16leSlice: decodedRange,
      utf8Slice: decodedRange,
      asciiWrite: encodedWrite,
      base64Write: encodedWrite,
      base64urlWrite: encodedWrite,
      hexWrite: encodedWrite,
      latin1Write: encodedWrite,
      ucs2Write: encodedWrite,
      utf16leWrite: encodedWrite,
      utf8Write: encodedWrite,
      readBigInt64: numberRead(atOptionalOffset, b.bigint),
      readBigUInt64: numberRead(atOptionalOffset, b.bigint),
      readDouble: numberRead(atOptionalOffset, b.f64),
      readFloat: numberRead(atOptionalOffset, b.f64),
      readInt16: numberRead(atOptionalOffset, b.int(-(2 ** 15), 2 ** 15 - 1)),
      readInt32: numberRead(atOptionalOffset, b.i32),
      readIntBE: signedWithWidth,
      readIntLE: signedWithWidth,
      readUIntBE: unsignedWithWidth,
      readUIntLE: unsignedWithWidth,
      writeDouble: numberWrite(8),
      writeFloat: numberWrite(4),
      writeUInt16: numberWrite(2),
      writeUInt32: numberWrite(4),
      writeIntBE: numberWriteWithWidth,
      writeIntLE: numberWriteWithWidth,
      writeUIntBE: numberWriteWithWidth,
      writeUIntLE: numberWriteWithWidth,
    },
  }),
  b.same("Buffer.prototype.toLocaleString", "Buffer.prototype.toString"),
  b.same("Buffer.prototype.readUintBE", "Buffer.prototype.readUIntBE"),
  b.same("Buffer.prototype.readUintLE", "Buffer.prototype.readUIntLE"),
  b.same("Buffer.prototype.writeUintBE", "Buffer.prototype.writeUIntBE"),
  b.same("Buffer.prototype.writeUintLE", "Buffer.prototype.writeUIntLE"),
  b.same("Buffer.prototype.writeUint16", "Buffer.prototype.writeUInt16"),
  b.same("Buffer.prototype.writeUint32", "Buffer.prototype.writeUInt32"),
  // The module takes the constructors from the realm, not from the names of the global object.
  b.same("node:buffer.Buffer", "Buffer"),
  b.same("node:buffer.Blob", "Blob"),
);
