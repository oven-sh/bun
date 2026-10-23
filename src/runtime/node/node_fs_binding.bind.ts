import * as b from "../../codegen/bindgen-lib.ts";
import * as table from "../../codegen/builtins/lib.ts";

export default b.module({ rustPath: "crate::node::node_fs_binding" });

/** Arguments are parsed in `node_fs.rs`, which throws Node's errors. */
const operation = (length: number, ...returns: readonly string[]) =>
  ({
    args: { args: b.any.variadic },
    returns: b.any.returning(...returns),
    capability: "js",
    throws: true,
    length,
  }) as const;

/** What `x` and `xSync` do with an argument (`args::*::from_js` in node_fs.rs): they keep none and return none. */
const uses = {
  this: table.inspected,
  args: [
    ...table.hostOptionBag([
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

/** What `xSync` returns, where that is not `undefined`. */
const syncResults: Record<string, readonly string[]> = {
  access: ["null"],
  exists: ["boolean"],
  fstat: ["object"],
  lstat: ["object", "undefined"],
  mkdir: ["string", "undefined"],
  mkdtemp: ["string", "object"],
  open: ["number"],
  read: ["number"],
  readdir: ["Array"],
  readFile: ["string", "object"],
  readlink: ["string", "object"],
  readv: ["number"],
  realpath: ["string", "object"],
  realpathNative: ["string", "object"],
  stat: ["object", "undefined"],
  statfs: ["object"],
  write: ["number"],
  writev: ["number"],
};

const getter = { getter: b.any.returning("object"), capability: "js" } as const;

/** The default export of `src/js/internal/fs/binding.ts`. */
export const NodeJSFS = b.class({
  rustPath: "crate::node::node_fs_binding::Binding",
  types: [table.exactType("$Node.NodeJSFS"), table.exactType("$Bindgen.NodeJSFS")],
  proto: Object.fromEntries(
    [
      ...Object.entries(operations).flatMap(([name, [length, syncLength]]) => [
        [name, { ...operation(length, "Promise"), uses }] as const,
        [`${name}Cb`, operation(length + 1, "undefined")] as const,
        [`${name}Sync`, { ...operation(syncLength, ...(syncResults[name] ?? ["undefined"])), uses }] as const,
      ]),
      ["cp", { ...operation(2, "Promise"), uses }] as const,
      ["cpSync", { ...operation(2, "undefined"), uses }] as const,
      ["watch", operation(3, "FSWatcher", "undefined")] as const,
      ["watchFile", operation(3, "StatWatcher", "undefined")] as const,
      ["Dirent", getter] as const,
      ["Stats", getter] as const,
    ].sort(([x], [y]) => x.localeCompare(y)),
  ),
});

export const binding = b.value({ returns: NodeJSFS, capability: "js" });

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
