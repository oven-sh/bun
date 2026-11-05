import * as b from "../../codegen/bindgen-lib.ts";
import { callbacksOfFsCell } from "../../codegen/builtins/host/native-cells.ts";
import * as table from "../../codegen/builtins/lib.ts";

export default b.module({ rustPath: "crate::node::node_fs_binding" });

/** Arguments are parsed in `node_fs.rs`, which throws Node's errors. */
const operation = (length: number, ...returns: readonly (string | table.TableType["spec"])[]) =>
  ({
    args: { args: b.any.variadic },
    returns: b.any.returning(...returns),
    capability: "js",
    throws: true,
    length,
  }) as const;

/** `x` and `xSync` run what an argument names while they parse it, and nothing else: `NodeFS::dispatch` never enters JavaScript. */
const parsesArguments = (length: number, returns: table.TableType) =>
  ({ ...operation(length, returns.spec), runsOnlyOperandCode: true, uses }) as const;

/** What `x` and `xSync` do with an argument (`args::*::from_js` in node_fs.rs): they keep none and return none. */
const uses = {
  this: table.inspected,
  args: [
    ...table.optionBag([
      "bigint",
      "encoding",
      "flag",
      "flush",
      "force",
      "maxRetries",
      "mode",
      "recursive",
      "retryDelay",
      "signal",
      "throwIfNoEntry",
      "withFileTypes",
    ]),
    table.readsContents(),
    table.writesContents(),
    table.printedByFormatter("constructor"),
  ],
};

/** `FsCompletion::reject` (node_fs.rs) and `reject_before_schedule`: an error of the system, that of a signal that has aborted, or that of a result that cannot be made. */
const error = table.union(table.instance("Error"), table.instance("RangeError"));
const nullOrError = table.union(table.strictNull, error);

/**
 * `xCb` keeps its callback (`FsCompletion::Callback`) and calls it once the operation is done: with the error, or with `null` and the result.
 * Where it fails before anything is scheduled it queues the callback with the error, and for that it calls process.nextTick.
 */
const callsBack = (length: number, value: table.TableType) =>
  ({
    ...operation(length, table.undefined.spec),
    uses: {
      this: table.inspected,
      args: [
        ...uses.args,
        table.storedIn(table.nativeCell(callbacksOfFsCell)),
        table.called({
          afterwards: "TouchesOnlyWhatRowNames",
          times: "Later",
          this: table.undefined,
          args: [nullOrError, value],
          result: "Ignored",
        }),
      ],
    },
  }) as const;

/** `[length of x, length of xSync]`. `xCb` is `x` with a leading callback. */
const operations: Record<string, readonly [number, number]> = {
  access: [3, 2],
  appendFile: [4, 3],
  chmod: [3, 2],
  chown: [4, 3],
  close: [1, 1],
  copyFile: [4, 3],
  exists: [2, 1],
  fchmod: [3, 2],
  fchown: [4, 3],
  fdatasync: [2, 1],
  fstat: [1, 1],
  fsync: [2, 1],
  ftruncate: [1, 1],
  futimes: [4, 3],
  lchmod: [3, 2],
  lchown: [4, 3],
  link: [3, 2],
  lstat: [1, 1],
  lutimes: [4, 3],
  mkdir: [3, 2],
  mkdtemp: [3, 2],
  open: [4, 3],
  read: [6, 5],
  readdir: [3, 2],
  readFile: [3, 2],
  readlink: [3, 2],
  readv: [4, 3],
  realpath: [3, 2],
  realpathNative: [3, 3],
  rename: [3, 2],
  rm: [3, 2],
  rmdir: [3, 2],
  stat: [1, 1],
  statfs: [2, 2],
  symlink: [4, 3],
  truncate: [3, 2],
  unlink: [2, 1],
  utimes: [4, 3],
  write: [6, 5],
  writeFile: [4, 3],
  writev: [4, 3],
};

/** `StringOrBuffer::into_js` of bytes that the operation owns. */
const textOrBytes = table.union(table.string, table.instance("Buffer")).fresh;
const stats = table.union(table.instance("Stats"), table.instance("BigIntStats")).fresh;
const statsIfFound = table.union(table.instance("Stats"), table.instance("BigIntStats"), table.undefined).fresh;

/** What `FsReturn::fs_to_js` makes of the `ret::*` of the operation (node_fs.rs), where that is not `undefined`. */
const results: Record<string, table.TableType> = {
  access: table.strictNull,
  exists: table.bool,
  fstat: stats,
  lstat: statsIfFound,
  mkdir: table.union(table.string, table.undefined),
  mkdtemp: textOrBytes,
  open: table.i32,
  read: table.f64,
  readdir: table
    .instance("Array")
    .holding({ element: table.union(table.string, table.instance("Buffer"), table.instance("Dirent")).fresh }).fresh,
  readFile: textOrBytes,
  readlink: textOrBytes,
  readv: table.f64,
  realpath: textOrBytes,
  realpathNative: textOrBytes,
  stat: statsIfFound,
  // NodeFSStatFSBinding.cpp: an ordinary object with eight numbers or bigints. Its prototype is an object that nothing else leads to.
  statfs: table.instance("Object"),
  write: table.f64,
  writev: table.f64,
};
const resultOf = (name: string) => results[name] ?? table.undefined;
/** `FsCompletion::Promise`: a promise of its own for each call. */
const promiseOf = (value: table.TableType) => table.instance("Promise").holding({ value, reason: error }).fresh;

const constructorOf = (path: string) =>
  ({ getter: b.any.returning(table.builtin(path).spec), capability: "js" }) as const;

/** The default export of `src/js/internal/fs/binding.ts`. */
export const NodeJSFS = b.class({
  rustPath: "crate::node::node_fs_binding::Binding",
  types: [table.exactType("$Node.NodeJSFS"), table.exactType("$Bindgen.NodeJSFS")],
  proto: Object.fromEntries(
    [
      ...Object.entries(operations).flatMap(([name, [length, syncLength]]) => [
        [name, parsesArguments(length, promiseOf(resultOf(name)))] as const,
        [`${name}Cb`, callsBack(length + 1, resultOf(name))] as const,
        [`${name}Sync`, parsesArguments(syncLength, resultOf(name))] as const,
      ]),
      ["cp", parsesArguments(2, promiseOf(table.undefined))] as const,
      ["cpSync", parsesArguments(2, table.undefined)] as const,
      ["watch", operation(3, "FSWatcher", "undefined")] as const,
      ["watchFile", operation(3, "StatWatcher", "undefined")] as const,
      ["Dirent", constructorOf("%Dirent%")] as const,
      ["Stats", constructorOf("%Stats%")] as const,
    ].sort(([x], [y]) => x.localeCompare(y)),
  ),
});

export const binding = b.value({ returns: NodeJSFS, capability: "js" });

/** `fs.createReadStream` / `fs.createWriteStream`'s `windowsHandle`. Windows only. */
export const windowsHandleToFd = b.fn({ args: { handle: b.any }, returns: b.i32, capability: "js", throws: true });

export const RmOptions = b.dictionary({
  retryDelay: b.u32,
  maxRetries: b.u32,
  recursive: b.bool,
  force: b.bool,
});
/** `(path, options)`, parsed as `fs.rm` parses them. */
export const rmOptionsForTesting = b.fn({
  args: { args: b.any.variadic },
  returns: RmOptions,
  capability: "js",
  throws: true,
  length: 2,
});
export const stringToFlagsForTesting = b.fn({ args: { flags: b.any }, returns: b.i32, capability: "js", throws: true });
/** Without `size` it makes nothing. */
export const createMemfdForTesting = b.fn({
  args: { size: b.f64.optional },
  returns: b.i32.optional,
  capability: "js",
  throws: true,
  length: 1,
});
