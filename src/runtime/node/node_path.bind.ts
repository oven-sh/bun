// The native functions of `path.posix` and `path.win32`. src/js/node/path.ts puts them on the two objects.
import * as b from "../../codegen/bindgen-lib.ts";
import * as table from "../../codegen/builtins/lib.ts";

export default b.module({ rustPath: "crate::node::path" });

const text = b.string.allowStringObject.local;
const result = b.string.local;

/** A UNC root that is longer than any path of the system is answered with the error, which is not thrown. */
const resultOrError = b.any;

/** An operand that is refused is described in the message of the error: that reads its constructor.name or prints it the way console.log does. Nothing keeps it. */
const describedInMessage = (...membersRead: string[]) => [table.printedByFormatter("constructor", ...membersRead)];

/** What a function that looks at nothing but its operands says to the table of built-ins. */
const ofOperandsAlone = { reads: [], writes: [] } as const;
/** The working directory completes a path that is not absolute, and on Windows a variable of the environment names that of a drive. */
const ofWorkingDirectory = { reads: ["ExternalState"], writes: [] } as const;

export const ParsedPath = b.dictionary({ root: result, dir: result, base: result, ext: result, name: result });

const ofPath = (name: string, returns: b.Type) =>
  b.fn({
    name,
    length: 1,
    args: { path: text },
    validatorExpects: { path: "string" },
    returns,
    capability: "heap",
    throws: true,
    ...ofOperandsAlone,
  });

const basename = () =>
  b.fn({
    name: "basename",
    length: 1,
    args: { path: text, ext: text.optional },
    validatorExpects: { path: "string", ext: "string" },
    convertedFirst: ["ext"],
    returns: result,
    capability: "heap",
    throws: true,
    ...ofOperandsAlone,
  });

/** Of a rope it reads the first characters where they are, so it allocates nothing. */
const isAbsolute = () =>
  b.fn({
    name: "isAbsolute",
    length: 1,
    args: { path: text },
    validatorExpects: { path: "string" },
    returns: b.bool,
    ...ofOperandsAlone,
  });

const join = () =>
  b.fn({
    name: "join",
    length: 1,
    args: { paths: b.rest(text) },
    validatorExpects: { paths: "string" },
    returns: result,
    capability: "heap",
    throws: true,
    ...ofOperandsAlone,
  });

const relative = (returns: b.Type) =>
  b.fn({
    name: "relative",
    length: 1,
    args: { from: text, to: text },
    validatorExpects: { from: "string", to: "string" },
    returns,
    capability: "heap",
    throws: true,
    ...ofWorkingDirectory,
  });

/** It looks at its arguments from the last to the first that is absolute, and only one it looks at has to be a string. */
const resolve = (returns: b.Type) =>
  b.fn({
    name: "resolve",
    length: 1,
    args: { paths: b.rest(b.any.stringObjectAsString) },
    returns,
    capability: "heap",
    throws: true,
    uses: { paths: describedInMessage() },
    ...ofWorkingDirectory,
  });

const format = () =>
  b.fn({
    name: "format",
    length: 1,
    args: { pathObject: b.any },
    returns: result,
    capability: "js",
    throws: true,
    runsOnlyOperandCode: true,
    uses: { pathObject: describedInMessage("root", "dir", "base", "name", "ext") },
    ...ofOperandsAlone,
  });

export const basenamePosix = basename();
export const dirnamePosix = ofPath("dirname", result);
export const extnamePosix = ofPath("extname", result);
export const formatPosix = format();
export const isAbsolutePosix = isAbsolute();
export const joinPosix = join();
export const normalizePosix = ofPath("normalize", result);
export const parsePosix = ofPath("parse", ParsedPath);
export const relativePosix = relative(result);
export const resolvePosix = resolve(result);
export const toNamespacedPathPosix = b.fn({
  name: "toNamespacedPath",
  length: 1,
  args: { path: b.any },
  returns: b.any,
  capability: "heap",
  uses: { path: [table.returned] },
  ...ofOperandsAlone,
});

export const basenameWin32 = basename();
export const dirnameWin32 = ofPath("dirname", result);
export const extnameWin32 = ofPath("extname", result);
export const formatWin32 = format();
export const isAbsoluteWin32 = isAbsolute();
export const joinWin32 = join();
export const normalizeWin32 = ofPath("normalize", result);
export const parseWin32 = ofPath("parse", ParsedPath);
export const relativeWin32 = relative(resultOrError);
export const resolveWin32 = resolve(resultOrError);
/** A `String` object counts as a string, and an empty one is answered as it is. */
export const toNamespacedPathWin32 = b.fn({
  name: "toNamespacedPath",
  length: 1,
  args: { path: b.any },
  returns: b.any,
  capability: "js",
  throws: true,
  runsOnlyOperandCode: true,
  uses: { path: [table.returned, table.runs("ToPrimitive")] },
  ...ofWorkingDirectory,
});
