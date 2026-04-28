// Shared helpers for `fs.rm` / `fs.rmSync` / `fs.promises.rm`.

// Node.js throws a SystemError with code `ERR_FS_EISDIR` when `fs.rm*`
// is called on a directory without `recursive: true`. Bun's native
// binding surfaces the raw `EISDIR` from unlink(2), so we rewrap it here
// to match Node.js's shape. See https://github.com/oven-sh/bun/issues/28958.
function maybeRemapRmEISDIR(err: any, path: any, options: any) {
  if (!err || err.code !== "EISDIR") return err;
  // If the caller passed `recursive: true`, an EISDIR here would be
  // unexpected — leave the original error alone.
  if (options != null && typeof options === "object" && options.recursive) return err;
  let pathString: string | undefined;
  if (typeof path === "string") {
    pathString = path;
  } else if (path instanceof URL) {
    try {
      pathString = Bun.fileURLToPath(path as URL);
    } catch {
      pathString = undefined;
    }
  } else if (Buffer.isBuffer(path)) {
    pathString = path.toString();
  } else if (typeof err.path === "string") {
    pathString = err.path;
  }
  const pathSuffix = pathString !== undefined ? " " + pathString : "";
  const wrapped: any = new Error(`Path is a directory: rm returned EISDIR (is a directory)${pathSuffix}`);
  wrapped.name = "SystemError";
  wrapped.code = "ERR_FS_EISDIR";
  wrapped.errno = 21;
  wrapped.syscall = "rm";
  if (pathString !== undefined) wrapped.path = pathString;
  return wrapped;
}

export default {
  maybeRemapRmEISDIR,
};
