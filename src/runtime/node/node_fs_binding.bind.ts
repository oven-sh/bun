import * as b from "../../codegen/bindgen-lib.ts";

/** Arguments are parsed in `node_fs.rs`, which throws Node's errors. */
const operation = (length: number) =>
  ({ args: { args: b.any.variadic }, returns: b.any, capability: "js", throws: true, length }) as const;

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

const getter = { getter: b.any, capability: "js" } as const;

/** What `createBinding` makes: `src/js/internal/fs/binding.ts`. */
export const NodeJSFS = b.class({
  rustPath: "crate::node::node_fs_binding::Binding",
  proto: Object.fromEntries(
    [
      ...Object.entries(operations).flatMap(([name, [length, syncLength]]) => [
        [name, operation(length)] as const,
        [`${name}Cb`, operation(length + 1)] as const,
        [`${name}Sync`, operation(syncLength)] as const,
      ]),
      ["cp", operation(2)] as const,
      ["cpSync", operation(2)] as const,
      ["watch", operation(3)] as const,
      ["watchFile", operation(3)] as const,
      ["Dirent", getter] as const,
      ["Stats", getter] as const,
    ].sort(([x], [y]) => x.localeCompare(y)),
  ),
});
