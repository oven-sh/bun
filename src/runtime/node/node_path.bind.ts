// The native functions of `path.posix` and `path.win32`. None of them runs what a script can replace: src/js/node/path.ts does that.
import * as b from "../../codegen/bindgen-lib.ts";
import * as table from "../../codegen/builtins/lib.ts";

export default b.module({ rustPath: "crate::node::path" });

const text = b.string.local;

/** The arguments of a function that takes strings alone. The message about anything else reads its constructor.name, or prints it the way console.log does. */
const strings = <Args extends Record<string, b.Type>>(args: Args) => ({
  args,
  expected: Object.fromEntries(Object.keys(args).map(name => [name, ["string"]])),
  uses: Object.fromEntries(Object.keys(args).map(name => [name, [table.printedByFormatter("constructor")]])),
});

/** What a function that looks at nothing but its operands says to the table of built-ins. */
const ofOperandsAlone = { reads: [], writes: [] } as const;
const allocates = { capability: "heap", throws: true, ...ofOperandsAlone } as const;

export const ParsedPath = b.dictionary({ root: text, dir: text, base: text, ext: text, name: text });

const ofPath = (name: string, returns: b.Type) => b.fn({ name, ...strings({ path: text }), returns, ...allocates });

const basename = () =>
  b.fn({
    name: "basename",
    length: 2,
    ...strings({ path: text, suffix: text.optional }),
    convertedFirst: ["suffix"],
    returns: text,
    ...allocates,
  });

/** Of a rope it reads the first characters where they are, so it allocates nothing. */
const isAbsolute = () => b.fn({ name: "isAbsolute", ...strings({ path: text }), returns: b.bool, ...ofOperandsAlone });

/** `undefined` where Node does not call `normalize`. */
const join = () => b.fn({ name: "join", ...strings({ path: b.rest(text) }), returns: text.optional, ...allocates });

/** What `join` passes to `normalize`, or answers without it. */
const concatenate = () => b.fn({ name: "join", args: { paths: b.rest(text) }, returns: text, ...allocates });

/** `undefined` if one of them takes a working directory. */
const relative = () =>
  b.fn({ name: "relative", ...strings({ from: text, to: text }), returns: text.optional, ...allocates });

const relativeOfResolved = () =>
  b.fn({ name: "relative", args: { from: text, to: text }, returns: text, ...allocates });

/** A number is the index of what is no string, -1 if it takes the working directory, or minus the code of the letter if it takes that of a drive. */
const resolve = () =>
  b.fn({
    name: "resolve",
    args: { paths: b.rest(b.any) },
    returns: b.any.returning("string", "int32"),
    uses: { paths: table.inspected },
    ...allocates,
  });

const resolveFrom = () =>
  b.fn({ name: "resolve", args: { directory: text, paths: b.rest(text) }, returns: text, ...allocates });

export const basenamePosix = basename();
export const concatenatePosix = concatenate();
export const dirnamePosix = ofPath("dirname", text);
export const extnamePosix = ofPath("extname", text);
export const isAbsolutePosix = isAbsolute();
export const joinPosix = join();
export const normalizePosix = ofPath("normalize", text);
export const parsePosix = ofPath("parse", ParsedPath);
export const relativePosix = relative();
export const relativeOfResolvedPosix = relativeOfResolved();
export const resolvePosix = resolve();
export const resolveFromPosix = resolveFrom();

export const basenameWin32 = basename();
export const concatenateWin32 = concatenate();
export const dirnameWin32 = ofPath("dirname", text);
export const extnameWin32 = ofPath("extname", text);
export const isAbsoluteWin32 = isAbsolute();
export const joinWin32 = join();
export const normalizeWin32 = ofPath("normalize", text);
export const parseWin32 = ofPath("parse", ParsedPath);
export const relativeWin32 = relative();
export const relativeOfResolvedWin32 = relativeOfResolved();
export const resolveWin32 = resolve();
export const resolveFromWin32 = resolveFrom();

/** `process.cwd()` with backslashes for `win32`, and else with slashes and from the first of them on. */
export const respell = b.fn({ args: { directory: text, win32: b.bool }, returns: text, ...allocates });

/** The variable `=C:` of the environment, which only Windows has and `process.env` lacks. */
export const workingDirectoryOfDrive = b.fn({
  args: { letter: b.u8 },
  returns: text.optional,
  capability: "heap",
  throws: true,
  reads: ["ExternalState"],
  writes: [],
});

const { args: pathAndPattern, ...aboutPathAndPattern } = strings({ path: text, pattern: text });
export const matchesGlob = b.fn({
  args: { ...pathAndPattern, win32: b.bool, ignoresCase: b.bool },
  ...aboutPathAndPattern,
  returns: b.bool,
  ...allocates,
});
