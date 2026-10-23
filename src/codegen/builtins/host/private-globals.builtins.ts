// The native functions that Bun's own modules call under private names of the global object.
import * as b from "bun-builtins-table";
import { numberedErrorCodes } from "../../replacements.ts";
import { asyncContextCell, closedPromiseOfStreamCell, printsErrorWithCodeCell } from "./native-cells.ts";
import { handedOver } from "./native-code.ts";

const promiseState = ["PromiseState"];

const changesNothing = (returns: b.TableType): b.FunctionField => ({
  args: { operands: b.any.rest },
  returns,
  capability: "js",
  throws: true,
  uses: { operands: handedOver },
  implementation: b.hostCall,
});

const resultsOfFunctionsChangingNothing = {
  inherits: b.bool,
  webStreamControllerError: b.undefined,
};

// ErrorCode.cpp: an error with a code is an instance of the kind of error the code stands for, with an object of its own for each code in front of the prototype of that kind.
const kindsOfErrorsWithCode = ["Error", "TypeError", "RangeError", "SyntaxError", "URIError"];
const [firstKind, ...otherKinds] = kindsOfErrorsWithCode.map(kind => b.instance(kind));
const newErrorWithCode = b.union(firstKind, ...otherKinds).unaliased;
const printsErrorWithCode = b.builtin("%NativeFunctions%.ErrorCodeCppNodeError_proto_toString");
const membersInheritedByErrorWithCode = { name: b.string, code: b.string, toString: printsErrorWithCode };

// The message reads constructor.name of a value, converts it to a string, or prints it the way console.log does.
const formattedInMessage = [b.printedByFormatter("constructor")];

// These put an operand on the error as it is, and ERR_UNHANDLED_ERROR answers what an exception of the engine holds.
const errorCodesKeepingOperands = [
  "ERR_INVALID_ADDRESS_FAMILY",
  "ERR_INVALID_URL",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "ERR_UNHANDLED_ERROR",
  "ERR_VM_MODULE_LINK_FAILURE",
];

function numberOfErrorCode(name: string): number {
  const found = numberedErrorCodes.find(code => code.name === name);
  if (found === undefined) throw new Error(`${name} is no error code of src/jsc/bindings/ErrorCode.ts`);
  return found.number;
}

// The numbers between those of the codes that keep an operand. A call spells its code out, and the first range that holds it takes the call.
function rangesOfErrorCodesKeepingNothing(): [number, number][] {
  const kept = errorCodesKeepingOperands.map(numberOfErrorCode).sort((left, right) => left - right);
  const last = Math.max(...numberedErrorCodes.map(code => code.number));
  const starts = [0, ...kept.map(number => number + 1)];
  const ends = [...kept.map(number => number - 1), last];
  return starts.map((start, index): [number, number] => [start, ends[index]]).filter(([start, end]) => start <= end);
}

const makesErrorWithCode = [
  ...rangesOfErrorCodesKeepingNothing().map(([first, last]): b.FunctionField => ({
    args: { code: b.int(first, last), operands: b.any.rest },
    returns: newErrorWithCode,
    // ERR_SSL_NO_CIPHER_MATCH.
    resultProperties: { ...membersInheritedByErrorWithCode, reason: b.string, library: b.string },
    capability: "js",
    throws: true,
    runsOnlyOperandCode: true,
    uses: { operands: formattedInMessage },
    implementation: b.hostCall,
  })),
  changesNothing(b.any),
];

// An object that the conversion of the message throws, or the getter of the cause, is the answer.
const makesAbortError = [
  {
    args: { message: b.string.optional, options: b.undefined.optional },
    returns: b.instance("Error").unaliased,
    resultProperties: membersInheritedByErrorWithCode,
    capability: "heap",
    implementation: b.hostCall,
  },
  changesNothing(b.any),
] satisfies b.FunctionField[];

const looksAtPromise = (returns: b.TableType, otherwise: b.TableType, uses: readonly b.UseSpec[] = b.inspected) =>
  [
    {
      args: { promise: b.instance("Promise") },
      returns,
      capability: "none",
      uses: { promise: uses },
      reads: promiseState,
      implementation: b.hostCall,
    },
    {
      args: { promise: b.any },
      returns: otherwise,
      capability: "none",
      uses: { promise: b.inspected },
      implementation: b.hostCall,
    },
  ] satisfies b.FunctionField[];

// The stream makes the promise at the first call and keeps it. It is fulfilled with undefined, or rejected with the error of the stream.
const closedPromise = b.instance("Promise").holding({ value: b.undefined, reason: b.any });

export default b.declarations(
  // Each of those objects has a function of its own, and one entry stands for them all. It reads the three members of its receiver and converts each to a string.
  b.hostFunction(printsErrorWithCodeCell, "ErrorCode.cpp", "NodeError_proto_toString", {
    this: b.any,
    returns: b.string,
    capability: "js",
    throws: true,
    runsOnlyOperandCode: true,
    uses: { this: [b.runsTransitively(b.named("name", "code", "message"), "ToPrimitive")] },
    implementation: b.hostCall,
  }),
  b.extend("native:NewCppFunction:ErrorCode.cpp:NodeError_proto_toString", {
    functionObjectCode: { symbol: "NodeError_proto_toString", header: "ErrorCode.h" },
    length: 0,
  }),
  b.namespace("%PrivateGlobals%", {
    ...Object.fromEntries(
      Object.entries(resultsOfFunctionsChangingNothing).map(([name, returns]) => [name, changesNothing(returns)]),
    ),
    // The object that runtime-dependencies.builtins.ts describes.
    asyncContext: b.property(b.object, {
      createdOnFirstRead: { capability: "none", uses: { this: [b.returnedFrom(asyncContextCell)] } },
    }),
    makeAbortError: makesAbortError,
    makeErrorWithCode: makesErrorWithCode,
    peekPromiseSettledValue: looksAtPromise(
      b.union(b.slot("promise", "value"), b.slot("promise", "reason"), b.undefined),
      b.undefined,
      [b.readsContents()],
    ),
    peekPromiseStatus: looksAtPromise(b.int(0, 2), b.int(0, 0)),
    pokePromiseAsHandled: {
      args: { promise: b.any },
      returns: b.undefined,
      capability: "none",
      uses: { promise: b.inspected },
      writes: promiseState,
      implementation: b.hostCall,
    },
    webStreamClosedPromise: {
      args: { stream: b.any.optional },
      returns: b.instance("Promise"),
      capability: "heap",
      throws: true,
      uses: {
        stream: [
          b.createdIn(closedPromise.fresh, b.nativeCell(closedPromiseOfStreamCell)),
          b.returnedFrom(closedPromiseOfStreamCell),
        ],
      },
      implementation: b.hostCall,
    },
    // It makes a function a class: under the base, with a new object under the prototype of the base as its prototype, and with the name.
    toClass: {
      args: { target: b.any, name: b.any.optional, base: b.any.optional },
      returns: b.undefined,
      capability: "js",
      throws: true,
      uses: {
        target: [...handedOver, b.prototypeSetTo("base"), b.definesName(["prototype", "name"], b.any)],
        name: handedOver,
        base: handedOver,
      },
      model: b.functionIn("models/Objects", "toClass"),
      implementation: b.hostCall,
    },
  }),
);
