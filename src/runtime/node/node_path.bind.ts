// The native functions of `path.posix` and `path.win32`.
import * as b from "../../codegen/bindgen-lib.ts";
import * as table from "../../codegen/builtins/lib.ts";

export default b.module({ rustPath: "crate::node::path" });

const string = b.string.local;

/** ERR_INVALID_ARG_TYPE describes the value that it received. */
const describedInError = [table.printedByFormatter("constructor")];

const stringArgs = <Args extends Record<string, b.Type>>(args: Args) => ({
  args,
  expected: Object.fromEntries(Object.keys(args).map(name => [name, ["string"]])),
  uses: Object.fromEntries(Object.keys(args).map(name => [name, describedInError])),
});

const pure = { reads: [], writes: [] } as const;
const allocates = { capability: "heap", throws: true, ...pure } as const;
const readsCachedCwd = {
  ...allocates,
  reads: ["ObjectFields", "NamedProperties", "ShapeWords", "ExternalState"],
} as const;
const runsJs = { capability: "js", throws: true } as const;

export const ParsedPath = b.dictionary({ root: string, dir: string, base: string, ext: string, name: string });

const ofPath = (name: string, returns: b.Type) =>
  b.fn({ name, ...stringArgs({ path: string }), returns, ...allocates });

const basename = () =>
  b.fn({
    name: "basename",
    length: 2,
    ...stringArgs({ path: string, suffix: string.optional }),
    convertedFirst: ["suffix"],
    returns: string,
    ...allocates,
  });

const isAbsolute = () => b.fn({ name: "isAbsolute", ...stringArgs({ path: string }), returns: b.bool, ...pure });

const matchesGlob = () =>
  b.fn({ name: "matchesGlob", ...stringArgs({ path: string, pattern: string }), returns: b.bool, ...allocates });

export const basenamePosix = basename();
export const dirnamePosix = ofPath("dirname", string);
export const extnamePosix = ofPath("extname", string);
export const isAbsolutePosix = isAbsolute();
export const matchesGlobPosix = matchesGlob();
export const normalizePosix = ofPath("normalize", string);
export const parsePosix = ofPath("parse", ParsedPath);

export const basenameWin32 = basename();
export const dirnameWin32 = ofPath("dirname", string);
export const extnameWin32 = ofPath("extname", string);
export const isAbsoluteWin32 = isAbsolute();
export const matchesGlobWin32 = matchesGlob();
export const normalizeWin32 = ofPath("normalize", string);
export const parseWin32 = ofPath("parse", ParsedPath);

// For src/js/node/path.ts. These call `process.cwd`, `normalize` and `resolve` if a script has replaced them.
const join = () => b.fn({ name: "join", ...stringArgs({ path: b.rest(string) }), returns: b.any, ...runsJs });
const relative = () =>
  b.fn({ name: "relative", ...stringArgs({ from: string, to: string }), returns: string, ...runsJs });
const resolve = () =>
  b.fn({
    name: "resolve",
    args: { paths: b.any.variadic },
    uses: { paths: describedInError },
    returns: b.any,
    ...runsJs,
  });

export const joinPosix = join();
export const relativePosix = relative();
export const resolvePosix = resolve();
export const joinWin32 = join();
export const relativeWin32 = relative();
export const resolveWin32 = resolve();

export const registerModule = b.fn({
  args: { posix: b.object, win32: b.object },
  cppSymbol: "Bun__Path__registerModule",
  capability: "js",
});

// For src/js/ahead-of-time/node/path.ts, which makes those calls itself so that the compiler sees them.

/** `undefined` if every path is empty: the result is ".", and `normalize` is not called. */
const tryJoin = () =>
  b.fn({ name: "join", ...stringArgs({ path: b.rest(string) }), returns: string.optional, ...allocates });
const joinUnnormalized = () => b.fn({ name: "join", args: { paths: b.rest(string) }, returns: string, ...allocates });
/** `undefined` if it needs a cwd. */
const tryRelative = () =>
  b.fn({ name: "relative", ...stringArgs({ from: string, to: string }), returns: string.optional, ...allocates });
const relativeOfResolved = () =>
  b.fn({ name: "relative", args: { from: string, to: string }, returns: string, ...allocates });
/** A number `n >= 0`: `paths[n]` is not a string. Otherwise it needs the cwd of the drive letter `~n`, or of the process if that is 0. */
const tryResolve = () =>
  b.fn({
    name: "resolve",
    args: { paths: b.any.variadic },
    uses: { paths: table.inspected },
    returns: b.any.returning("string", "int32"),
    ...readsCachedCwd,
  });
const resolveWithCwd = () =>
  b.fn({
    name: "resolve",
    args: { cwd: string, paths: b.any.variadic },
    uses: { paths: table.inspected },
    returns: string,
    ...allocates,
  });

export const tryJoinPosix = tryJoin();
export const joinUnnormalizedPosix = joinUnnormalized();
export const tryRelativePosix = tryRelative();
export const relativeOfResolvedPosix = relativeOfResolved();
export const tryResolvePosix = tryResolve();
export const resolveWithCwdPosix = resolveWithCwd();
export const tryJoinWin32 = tryJoin();
export const joinUnnormalizedWin32 = joinUnnormalized();
export const tryRelativeWin32 = tryRelative();
export const relativeOfResolvedWin32 = relativeOfResolved();
export const tryResolveWin32 = tryResolve();
export const resolveWithCwdWin32 = resolveWithCwd();

/** What `path.posix` makes of `process.cwd()` on Windows, and `path.win32` elsewhere. */
export const toForeignCwd = b.fn({ args: { cwd: string }, returns: string, ...allocates });

/** The variable `=C:` in the environment of the process. */
export const driveCwd = b.fn({
  args: { letter: b.u8 },
  returns: string.optional,
  ...allocates,
  reads: ["ExternalState"],
});

/** `path.resolve` for a path that goes to the file system, which ignores a replaced `process.cwd`. */
export const resolveWithRealCwd = b.fn({
  args: { paths: b.any.variadic },
  uses: { paths: describedInError },
  returns: string,
  ...runsJs,
  runsOnlyOperandCode: true,
});

const pathAndPattern = stringArgs({ path: string, pattern: string });
export const matchesGlobForTesting = b.fn({
  ...pathAndPattern,
  args: { ...pathAndPattern.args, win32: b.bool, nocase: b.bool },
  returns: b.bool,
  ...allocates,
});
