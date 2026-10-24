import * as b from "bun-builtins-table";

const terminal = ["ExternalState"];

const formatted = b.printedByFormatter("colors", "depth");

const logging = [
  {
    args: { values: b.primitiveValue.rest },
    capability: "heap",
    throws: true,
    reads: terminal,
    writes: terminal,
    implementation: b.hostCall,
  },
  {
    args: { values: b.any.rest },
    capability: "js",
    throws: true,
    runsOnlyOperandCode: true,
    uses: { values: [formatted] },
    reads: terminal,
    writes: terminal,
    implementation: b.hostCall,
  },
] satisfies b.FunctionField[];

const labeled = (label: b.TableType) =>
  ({
    args: { label },
    capability: "heap",
    throws: true,
    reads: terminal,
    writes: terminal,
    implementation: b.hostCall,
  }) satisfies b.FunctionField;

const withDefaultLabel = labeled(b.string.loose.optional);
const withOptionalTitle = labeled(b.string.loose.nullable);

const withoutOperands = {
  capability: "heap",
  reads: terminal,
  writes: terminal,
  implementation: b.hostCall,
} satisfies b.FunctionField;

// A property with a value for whoever asks for its descriptor. Native code makes the value at the first read and puts it there.
const createdOnFirstRead = b.property(b.any, { createdOnFirstRead: { capability: "js", throws: true } });

export default b.declarations(
  ["Console", "_stdout", "_stderr"].flatMap(name =>
    b.extend(`console.${name}`, { mutability: "ConstantUnlessWritten" }),
  ),
  b.namespace("console", {
    log: logging,
    info: logging,
    warn: logging,
    error: logging,
    debug: logging,
    trace: logging,
    dir: logging,
    dirxml: logging,
    table: logging,
    assert: logging,
    group: logging,
    groupCollapsed: logging,
    timeLog: logging,
    groupEnd: withoutOperands,
    clear: withoutOperands,
    count: withDefaultLabel,
    countReset: withDefaultLabel,
    time: withDefaultLabel,
    timeEnd: withDefaultLabel,
    profile: withOptionalTitle,
    profileEnd: withOptionalTitle,
    timeStamp: {
      args: { values: b.any.rest },
      capability: "heap",
      uses: { values: b.inspected },
      implementation: b.hostCall,
    },
    Console: createdOnFirstRead,
    _stdout: createdOnFirstRead,
    _stderr: createdOnFirstRead,
    write: {
      this: b.any,
      args: { chunks: b.any.rest },
      returns: b.any,
      capability: "js",
      throws: true,
      uses: { this: [b.everything], chunks: [b.everything] },
      implementation: b.compiled("builtins/ConsoleObject", "write"),
    },
    // The function that lies there at start-up stores another one in its place when it is called.
    "@@asyncIterator": b.property(b.callable, {
      mutability: "ChangesOnItsOwn",
      call: {
        this: b.any,
        returns: b.any,
        capability: "js",
        throws: true,
        uses: { this: [b.everything] },
        implementation: b.compiled("builtins/ConsoleObject", "asyncIterator"),
      },
    }),
  }),
);
