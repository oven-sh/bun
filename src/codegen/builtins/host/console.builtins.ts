import * as b from "bun-builtins-table";

const terminal = ["ExternalState"];

const formatted = b.printedByFormatter("colors", "depth");

// console.table makes a row of each value, of a function too, and a column of each of its keys.
const printing = (withoutCode: b.TableType, values: readonly b.UseSpec[] = [formatted]) =>
  [
    {
      args: { values: withoutCode.rest },
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
      uses: { values },
      reads: terminal,
      writes: terminal,
      implementation: b.hostCall,
    },
  ] satisfies b.FunctionField[];

// console.dir prints its first operand alone and console.timeLog each operand by itself: no text among them is read for directives.
const listing = printing(b.primitiveValue);
// "%j" calls the toJSON that a bigint inherits.
const formattedWithoutCode = b.union(b.null, b.bool, b.f64, b.string, b.symbol);
// print_proxy() in src/jsc/ConsoleObject.rs. console.dir reads its options, and console.table lists its rows, off whatever they are handed.
const logging = printing(formattedWithoutCode, [formatted]);

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
    dir: listing,
    dirxml: logging,
    // Where its first operand is no object it prints them all as console.log does.
    table: printing(formattedWithoutCode, [formatted]),
    assert: logging,
    group: logging,
    groupCollapsed: logging,
    timeLog: listing,
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
