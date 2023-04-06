/**
 * The `fs/promises` API provides asynchronous file system methods that return
 * promises.
 *
 * The promise APIs use the underlying Bun threadpool to perform file
 * system operations off the event loop thread. These operations are not
 * synchronized or threadsafe. Care must be taken when performing multiple
 * concurrent modifications on the same file or data corruption may occur.
 */
declare module "fs/promises" {
  import { ArrayBufferView } from "bun";
  import type {
    Stats,
    BigIntStats,
    StatOptions,
    MakeDirectoryOptions,
    Dirent,
    ObjectEncodingOptions,
    OpenMode,
    Mode,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    CopyOptions,
    EncodingOption,
    WriteFileOptions,
    SimlinkType,
    Abortable,
    RmOptions,
    RmDirOptions,
  } from "node:fs";

  interface FlagAndOpenMode {
    mode?: Mode | undefined;
    flag?: OpenMode | undefined;
  }
  interface FileReadResult<T extends ArrayBufferView> {
    bytesRead: number;
    buffer: T;
  }
  interface FileReadOptions<T extends ArrayBufferView = Buffer> {
    /**
     * @default `Buffer.alloc(0xffff)`
     */
    buffer?: T;
    /**
     * @default 0
     */
    offset?: number | null;
    /**
     * @default `buffer.byteLength`
     */
    length?: number | null;
    position?: number | null;
  }
  /**
   * Tests a user"s permissions for the file or directory specified by `path`.
   * The `mode` argument is an optional integer that specifies the accessibility
   * checks to be performed. `mode` should be either the value `fs.constants.F_OK`or a mask consisting of the bitwise OR of any of `fs.constants.R_OK`,`fs.constants.W_OK`, and `fs.constants.X_OK`
   * (e.g.`fs.constants.W_OK | fs.constants.R_OK`). Check `File access constants` for
   * possible values of `mode`.
   *
   * If the accessibility check is successful, the promise is resolved with no
   * value. If any of the accessibility checks fail, the promise is rejected
   * with an [Error](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error) object. The following example checks if the file`/etc/passwd` can be read and
   * written by the current process.
   *
   * ```js
   * import { access } from "fs/promises";
   * import { constants } from "fs";
   *
   * try {
   *   await access("/etc/passwd", constants.R_OK | constants.W_OK);
   *   console.log("can access");
   * } catch {
   *   console.error("cannot access");
   * }
   * ```
   *
   * Using `fsPromises.access()` to check for the accessibility of a file before
   * calling `fsPromises.open()` is not recommended. Doing so introduces a race
   * condition, since other processes may change the file"s state between the two
   * calls. Instead, user code should open/read/write the file directly and handle
   * the error raised if the file is not accessible.
   * @since v0.0.67
   * @param [mode=fs.constants.F_OK]
   * @return Fulfills with `undefined` upon success.
   */

  function access(path: PathLike, mode?: number): Promise<void>;
  /**
   * Asynchronously copies `src` to `dest`. By default, `dest` is overwritten if it
   * already exists.
   *
   * No guarantees are made about the atomicity of the copy operation. If an
   * error occurs after the destination file has been opened for writing, an attempt
   * will be made to remove the destination.
   *
   * ```js
   * import { constants } from "fs";
   * import { copyFile } from "fs/promises";
   *
   * try {
   *   await copyFile("source.txt", "destination.txt");
   *   console.log("source.txt was copied to destination.txt");
   * } catch {
   *   console.log("The file could not be copied");
   * }
   *
   * // By using COPYFILE_EXCL, the operation will fail if destination.txt exists.
   * try {
   *   await copyFile("source.txt", "destination.txt", constants.COPYFILE_EXCL);
   *   console.log("source.txt was copied to destination.txt");
   * } catch {
   *   console.log("The file could not be copied");
   * }
   * ```
   * @since v0.0.67
   * @param src source filename to copy
   * @param dest destination filename of the copy operation
   * @param [mode=0] Optional modifiers that specify the behavior of the copy operation. It is possible to create a mask consisting of the bitwise OR of two or more values (e.g.
   * `fs.constants.COPYFILE_EXCL | fs.constants.COPYFILE_FICLONE`)
   * @return Fulfills with `undefined` upon success.
   */
  function copyFile(
    src: PathLike,
    dest: PathLike,
    mode?: number,
  ): Promise<void>;
  /**
   * Opens a `FileHandle`.
   *
   * Refer to the POSIX [`open(2)`](http://man7.org/linux/man-pages/man2/open.2.html) documentation for more detail.
   *
   * Some characters (`< > : " / \ | ? *`) are reserved under Windows as documented
   * by [Naming Files, Paths, and Namespaces](https://docs.microsoft.com/en-us/windows/desktop/FileIO/naming-a-file). Under NTFS, if the filename contains
   * a colon, Node.js will open a file system stream, as described by [this MSDN page](https://docs.microsoft.com/en-us/windows/desktop/FileIO/using-streams).
   * @since v0.0.67
   * @param [flags="r"] See `support of file system `flags``.
   * @param [mode=0o666] Sets the file mode (permission and sticky bits) if the file is created.
   * @return Fulfills with a {FileHandle} object.
   */
  function open(path: PathLike, flags?: OpenMode, mode?: Mode): Promise<number>;
  /**
   * Renames `oldPath` to `newPath`.
   * @since v0.0.67
   * @return Fulfills with `undefined` upon success.
   */
  function rename(oldPath: PathLike, newPath: PathLike): Promise<void>;
  /**
   * Truncates (shortens or extends the length) of the content at `path` to `len`bytes.
   * @since v0.0.67
   * @param [len=0]
   * @return Fulfills with `undefined` upon success.
   */
  function truncate(path: PathLike, len?: number): Promise<void>;
  /**
   * Asynchronously creates a directory.
   *
   * The optional `options` argument can be an integer specifying `mode` (permission
   * and sticky bits), or an object with a `mode` property and a `recursive`property indicating whether parent directories should be created. Calling`fsPromises.mkdir()` when `path` is a directory
   * that exists results in a
   * rejection only when `recursive` is false.
   * @since v0.0.67
   * @return Upon success, fulfills with `undefined` if `recursive` is `false`, or the first directory path created if `recursive` is `true`.
   */
  function mkdir(
    path: PathLike,
    options: MakeDirectoryOptions & {
      recursive: true;
    },
  ): Promise<string | undefined>;
  /**
   * Asynchronous mkdir(2) - create a directory.
   * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
   * @param options Either the file mode, or an object optionally specifying the file mode and whether parent folders
   * should be created. If a string is passed, it is parsed as an octal integer. If not specified, defaults to `0o777`.
   */
  function mkdir(
    path: PathLike,
    options?:
      | Mode
      | (MakeDirectoryOptions & {
          recursive?: false | undefined;
        })
      | null,
  ): Promise<void>;
  /**
   * Asynchronous mkdir(2) - create a directory.
   * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
   * @param options Either the file mode, or an object optionally specifying the file mode and whether parent folders
   * should be created. If a string is passed, it is parsed as an octal integer. If not specified, defaults to `0o777`.
   */
  function mkdir(
    path: PathLike,
    options?: Mode | MakeDirectoryOptions | null | undefined,
  ): Promise<string | undefined>;
  /**
   * Reads the contents of a directory.
   *
   * The optional `options` argument can be a string specifying an encoding, or an
   * object with an `encoding` property specifying the character encoding to use for
   * the filenames. If the `encoding` is set to `"buffer"`, the filenames returned
   * will be passed as `Buffer` objects.
   *
   * If `options.withFileTypes` is set to `true`, the resolved array will contain `fs.Dirent` objects.
   *
   * ```js
   * import { readdir } from "fs/promises";
   *
   * try {
   *   const files = await readdir(path);
   *   for (const file of files)
   *     console.log(file);
   * } catch (err) {
   *   console.error(err);
   * }
   * ```
   * @since v0.0.67
   * @return Fulfills with an array of the names of the files in the directory excluding `"."` and `".."`.
   */
  function readdir(
    path: PathLike,
    options?:
      | (ObjectEncodingOptions & {
          withFileTypes?: false | undefined;
        })
      | BufferEncoding
      | undefined
      | null,
  ): Promise<string[]>;
  /**
   * Asynchronous readdir(3) - read a directory.
   * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
   * @param options The encoding (or an object specifying the encoding), used as the encoding of the result. If not provided, `"utf8"` is used.
   */
  function readdir(
    path: PathLike,
    options:
      | {
          encoding: "buffer";
          withFileTypes?: false | undefined;
        }
      | "buffer",
  ): Promise<Buffer[]>;
  /**
   * Asynchronous readdir(3) - read a directory.
   * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
   * @param options The encoding (or an object specifying the encoding), used as the encoding of the result. If not provided, `"utf8"` is used.
   */
  function readdir(
    path: PathLike,
    options?:
      | (ObjectEncodingOptions & {
          withFileTypes?: false | undefined;
        })
      | BufferEncoding
      | null,
  ): Promise<string[] | Buffer[]>;
  /**
   * Asynchronous readdir(3) - read a directory.
   * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
   * @param options If called with `withFileTypes: true` the result data will be an array of Dirent.
   */
  function readdir(
    path: PathLike,
    options: ObjectEncodingOptions & {
      withFileTypes: true;
    },
  ): Promise<Dirent[]>;
  /**
   * Reads the contents of the symbolic link referred to by `path`. See the POSIX [`readlink(2)`](http://man7.org/linux/man-pages/man2/readlink.2.html) documentation for more detail. The promise is
   * resolved with the`linkString` upon success.
   *
   * The optional `options` argument can be a string specifying an encoding, or an
   * object with an `encoding` property specifying the character encoding to use for
   * the link path returned. If the `encoding` is set to `"buffer"`, the link path
   * returned will be passed as a `Buffer` object.
   * @since v0.0.67
   * @return Fulfills with the `linkString` upon success.
   */
  function readlink(
    path: PathLike,
    options?: EncodingOption | BufferEncoding | null,
  ): Promise<string>;
  /**
   * Asynchronous readlink(2) - read value of a symbolic link.
   * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
   * @param options The encoding (or an object specifying the encoding), used as the encoding of the result. If not provided, `"utf8"` is used.
   */
  function readlink(
    path: PathLike,
    options: BufferEncodingOption,
  ): Promise<Buffer>;
  /**
   * Asynchronous readlink(2) - read value of a symbolic link.
   * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
   * @param options The encoding (or an object specifying the encoding), used as the encoding of the result. If not provided, `"utf8"` is used.
   */
  function readlink(
    path: PathLike,
    options?: EncodingOption | string | null,
  ): Promise<string | Buffer>;
  /**
   * Creates a symbolic link.
   *
   * The `type` argument is only used on Windows platforms and can be one of `"dir"`,`"file"`, or `"junction"`. Windows junction points require the destination path
   * to be absolute. When using `"junction"`, the `target` argument will
   * automatically be normalized to absolute path.
   * @since v0.0.67
   * @param [type="file"]
   * @return Fulfills with `undefined` upon success.
   */
  function symlink(
    target: PathLike,
    path: PathLike,
    type?: SimlinkType,
  ): Promise<void>;
  /**
   * Equivalent to `fsPromises.stat()` unless `path` refers to a symbolic link,
   * in which case the link itself is stat-ed, not the file that it refers to.
   * Refer to the POSIX [`lstat(2)`](http://man7.org/linux/man-pages/man2/lstat.2.html) document for more detail.
   * @since v0.0.67
   * @return Fulfills with the {fs.Stats} object for the given symbolic link `path`.
   */
  function lstat(
    path: PathLike,
    options?:
      | (StatOptions & {
          bigint?: false | undefined;
        })
      | undefined,
  ): Promise<Stats>;
  function lstat(
    path: PathLike,
    options: StatOptions & {
      bigint: true;
    },
  ): Promise<BigIntStats>;
  function lstat(
    path: PathLike,
    options?: StatOptions,
  ): Promise<Stats | BigIntStats>;
  /**
   * @since v0.0.67
   * @return Fulfills with the {fs.Stats} object for the given `path`.
   */
  function stat(
    path: PathLike,
    options?:
      | (StatOptions & {
          bigint?: false | undefined;
        })
      | undefined,
  ): Promise<Stats>;
  function stat(
    path: PathLike,
    options: StatOptions & {
      bigint: true;
    },
  ): Promise<BigIntStats>;
  function stat(
    path: PathLike,
    options?: StatOptions,
  ): Promise<Stats | BigIntStats>;
  /**
   * Creates a new link from the `existingPath` to the `newPath`. See the POSIX [`link(2)`](http://man7.org/linux/man-pages/man2/link.2.html) documentation for more detail.
   * @since v0.0.67
   * @return Fulfills with `undefined` upon success.
   */
  function link(existingPath: PathLike, newPath: PathLike): Promise<void>;
  /**
   * If `path` refers to a symbolic link, then the link is removed without affecting
   * the file or directory to which that link refers. If the `path` refers to a file
   * path that is not a symbolic link, the file is deleted. See the POSIX [`unlink(2)`](http://man7.org/linux/man-pages/man2/unlink.2.html) documentation for more detail.
   * @since v0.0.67
   * @return Fulfills with `undefined` upon success.
   */
  function unlink(path: PathLike): Promise<void>;
  /**
   * Changes the permissions of a file.
   * @since v0.0.67
   * @return Fulfills with `undefined` upon success.
   */
  function chmod(path: PathLike, mode: Mode): Promise<void>;
  /**
   * Changes the permissions on a symbolic link.
   *
   * This method is only implemented on macOS.
   * @deprecated Since v0.4.7
   * @return Fulfills with `undefined` upon success.
   */
  function lchmod(path: PathLike, mode: Mode): Promise<void>;
  /**
   * Changes the ownership on a symbolic link.
   * @return Fulfills with `undefined` upon success.
   */
  function lchown(path: PathLike, uid: number, gid: number): Promise<void>;
  /**
   * Changes the access and modification times of a file in the same way as `fsPromises.utimes()`, with the difference that if the path refers to a
   * symbolic link, then the link is not dereferenced: instead, the timestamps of
   * the symbolic link itself are changed.
   * @since v0.0.67
   * @return Fulfills with `undefined` upon success.
   */
  function lutimes(
    path: PathLike,
    atime: TimeLike,
    mtime: TimeLike,
  ): Promise<void>;
  /**
   * Changes the ownership of a file.
   * @since v0.0.67
   * @return Fulfills with `undefined` upon success.
   */
  function chown(path: PathLike, uid: number, gid: number): Promise<void>;
  /**
   * Change the file system timestamps of the object referenced by `path`.
   *
   * The `atime` and `mtime` arguments follow these rules:
   *
   * * Values can be either numbers representing Unix epoch time, `Date`s, or a
   * numeric string like `"123456789.0"`.
   * * If the value can not be converted to a number, or is `NaN`, `Infinity` or`-Infinity`, an `Error` will be thrown.
   * @since v0.0.67
   * @return Fulfills with `undefined` upon success.
   */
  function utimes(
    path: PathLike,
    atime: TimeLike,
    mtime: TimeLike,
  ): Promise<void>;
  /**
   * Determines the actual location of `path` using the same semantics as the`fs.realpath.native()` function.
   *
   * Only paths that can be converted to UTF8 strings are supported.
   *
   * The optional `options` argument can be a string specifying an encoding, or an
   * object with an `encoding` property specifying the character encoding to use for
   * the path. If the `encoding` is set to `"buffer"`, the path returned will be
   * passed as a `Buffer` object.
   *
   * On Linux, when Node.js is linked against musl libc, the procfs file system must
   * be mounted on `/proc` in order for this function to work. Glibc does not have
   * this restriction.
   * @since v0.0.67
   * @return Fulfills with the resolved path upon success.
   */
  function realpath(
    path: PathLike,
    options?: EncodingOption | null,
  ): Promise<string>;
  /**
   * Asynchronous realpath(3) - return the canonicalized absolute pathname.
   * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
   * @param options The encoding (or an object specifying the encoding), used as the encoding of the result. If not provided, `"utf8"` is used.
   */
  function realpath(
    path: PathLike,
    options: BufferEncodingOption,
  ): Promise<Buffer>;
  /**
   * Asynchronous realpath(3) - return the canonicalized absolute pathname.
   * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
   * @param options The encoding (or an object specifying the encoding), used as the encoding of the result. If not provided, `"utf8"` is used.
   */
  function realpath(
    path: PathLike,
    options?: EncodingOption | null,
  ): Promise<string | Buffer>;
  /**
   * Creates a unique temporary directory. A unique directory name is generated by
   * appending six random characters to the end of the provided `prefix`. Due to
   * platform inconsistencies, avoid trailing `X` characters in `prefix`. Some
   * platforms, notably the BSDs, can return more than six random characters, and
   * replace trailing `X` characters in `prefix` with random characters.
   *
   * The optional `options` argument can be a string specifying an encoding, or an
   * object with an `encoding` property specifying the character encoding to use.
   *
   * ```js
   * import { mkdtemp } from "fs/promises";
   *
   * try {
   *   await mkdtemp(path.join(os.tmpdir(), "foo-"));
   * } catch (err) {
   *   console.error(err);
   * }
   * ```
   *
   * The `fsPromises.mkdtemp()` method will append the six randomly selected
   * characters directly to the `prefix` string. For instance, given a directory`/tmp`, if the intention is to create a temporary directory _within_`/tmp`, the`prefix` must end with a trailing
   * platform-specific path separator
   * (`require("path").sep`).
   * @since v0.0.67
   * @return Fulfills with a string containing the filesystem path of the newly created temporary directory.
   */
  function mkdtemp(
    prefix: string,
    options?: EncodingOption | null,
  ): Promise<string>;
  /**
   * Asynchronously creates a unique temporary directory.
   * Generates six random characters to be appended behind a required `prefix` to create a unique temporary directory.
   * @param options The encoding (or an object specifying the encoding), used as the encoding of the result. If not provided, `"utf8"` is used.
   */
  function mkdtemp(
    prefix: string,
    options: BufferEncodingOption,
  ): Promise<Buffer>;
  /**
   * Asynchronously creates a unique temporary directory.
   * Generates six random characters to be appended behind a required `prefix` to create a unique temporary directory.
   * @param options The encoding (or an object specifying the encoding), used as the encoding of the result. If not provided, `"utf8"` is used.
   */
  function mkdtemp(
    prefix: string,
    options?: EncodingOption | null,
  ): Promise<string | Buffer>;
  /**
   * Asynchronously writes data to a file, replacing the file if it already exists.`data` can be a string, a buffer, an
   * [AsyncIterable](https://tc39.github.io/ecma262/#sec-asynciterable-interface) or
   * [Iterable](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Iteration_protocols#The_iterable_protocol) object.
   *
   * The `encoding` option is ignored if `data` is a buffer.
   *
   * If `options` is a string, then it specifies the encoding.
   *
   * The `mode` option only affects the newly created file. See `fs.open()` for more details.
   *
   * Any specified `FileHandle` has to support writing.
   *
   * It is unsafe to use `fsPromises.writeFile()` multiple times on the same file
   * without waiting for the promise to be settled.
   *
   * Similarly to `fsPromises.readFile` \- `fsPromises.writeFile` is a convenience
   * method that performs multiple `write` calls internally to write the buffer
   * passed to it. For performance sensitive code consider using `fs.createWriteStream()` or `filehandle.createWriteStream()`.
   *
   * It is possible to use an `AbortSignal` to cancel an `fsPromises.writeFile()`.
   * Cancelation is "best effort", and some amount of data is likely still
   * to be written.
   *
   * ```js
   * import { writeFile } from "fs/promises";
   * import { Buffer } from "buffer";
   *
   * try {
   *   const controller = new AbortController();
   *   const { signal } = controller;
   *   const data = new Uint8Array(Buffer.from("Hello Node.js"));
   *   const promise = writeFile("message.txt", data, { signal });
   *
   *   // Abort the request before the promise settles.
   *   controller.abort();
   *
   *   await promise;
   * } catch (err) {
   *   // When a request is aborted - err is an AbortError
   *   console.error(err);
   * }
   * ```
   *
   * Aborting an ongoing request does not abort individual operating
   * system requests but rather the internal buffering `fs.writeFile` performs.
   * @since v0.0.67
   * @param file filename or `FileHandle`
   * @return Fulfills with `undefined` upon success.
   */
  function writeFile(
    file: PathOrFileDescriptor,
    data: string | ArrayBufferView | ArrayBufferLike,
    options?: WriteFileOptions,
  ): Promise<void>;
  /**
   * Asynchronously append data to a file, creating the file if it does not yet
   * exist. `data` can be a string or a `Buffer`.
   *
   * If `options` is a string, then it specifies the `encoding`.
   *
   * The `mode` option only affects the newly created file. See `fs.open()` for more details.
   *
   * The `path` may be specified as a `FileHandle` that has been opened
   * for appending (using `fsPromises.open()`).
   * @since v0.0.67
   * @param path filename or {FileHandle}
   * @return Fulfills with `undefined` upon success.
   */
  function appendFile(
    path: PathOrFileDescriptor,
    data: string | Uint8Array,
    options?: WriteFileOptions,
  ): Promise<void>;
  /**
   * Asynchronously reads the entire contents of a file.
   *
   * If no encoding is specified (using `options.encoding`), the data is returned
   * as a `Buffer` object. Otherwise, the data will be a string.
   *
   * If `options` is a string, then it specifies the encoding.
   *
   * When the `path` is a directory, the behavior of `fsPromises.readFile()` is
   * platform-specific. On macOS, Linux, and Windows, the promise will be rejected
   * with an error. On FreeBSD, a representation of the directory"s contents will be
   * returned.
   *
   * It is possible to abort an ongoing `readFile` using an `AbortSignal`. If a
   * request is aborted the promise returned is rejected with an `AbortError`:
   *
   * ```js
   * import { readFile } from "fs/promises";
   *
   * try {
   *   const controller = new AbortController();
   *   const { signal } = controller;
   *   const promise = readFile(fileName, { signal });
   *
   *   // Abort the request before the promise settles.
   *   controller.abort();
   *
   *   await promise;
   * } catch (err) {
   *   // When a request is aborted - err is an AbortError
   *   console.error(err);
   * }
   * ```
   *
   * Aborting an ongoing request does not abort individual operating
   * system requests but rather the internal buffering `fs.readFile` performs.
   *
   * Any specified `FileHandle` has to support reading.
   * @since v0.0.67
   * @param path filename or `FileHandle`
   * @return Fulfills with the contents of the file.
   */
  function readFile(
    path: PathOrFileDescriptor,
    options?:
      | ({
          encoding?: null | undefined;
          flag?: string | undefined;
        } & Abortable)
      | null,
  ): Promise<Buffer>;
  /**
   * Asynchronously reads the entire contents of a file.
   * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
   * If a `FileHandle` is provided, the underlying file will _not_ be closed automatically.
   * @param options An object that may contain an optional flag.
   * If a flag is not provided, it defaults to `"r"`.
   */
  function readFile(
    path: PathOrFileDescriptor,
    options:
      | ({
          encoding: BufferEncoding;
          flag?: OpenMode | undefined;
        } & Abortable)
      | BufferEncoding,
  ): Promise<string>;
  /**
   * Asynchronously reads the entire contents of a file.
   * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
   * If a `FileHandle` is provided, the underlying file will _not_ be closed automatically.
   * @param options An object that may contain an optional flag.
   * If a flag is not provided, it defaults to `"r"`.
   */
  function readFile(
    path: PathOrFileDescriptor,
    options?:
      | (ObjectEncodingOptions &
          Abortable & {
            flag?: OpenMode | undefined;
          })
      | BufferEncoding
      | null,
  ): Promise<string | Buffer>;
  /**
   * Asynchronously removes files and directories (modeled on the standard POSIX `rm`utility). No arguments other than a possible exception are given to the
   * completion callback.
   * @since v14.14.0
   */
  export function rm(path: PathLike, options?: RmOptions): Promise<void>;

  /**
   * Asynchronously test whether or not the given path exists by checking with the file system.
   *
   * ```ts
   * import { exists } from 'fs/promises';
   *
   * const e = await exists('/etc/passwd');
   * e; // boolean
   * ```
   */
  function exists(path: PathLike): Promise<boolean>;

  /**
   * @deprecated Use `fs.promises.rm()` instead.
   *
   * Asynchronously remove a directory.
   *
   * ```ts
   * import { rmdir } from 'fs/promises';
   *
   * // remove a directory
   * await rmdir('/tmp/mydir'); // Promise<void>
   * ```
   *
   * To remove a directory recursively, use `fs.promises.rm()` instead, with the `recursive` option set to `true`.
   */
  function rmdir(path: PathLike, options?: RmDirOptions): Promise<void>;
}

declare module "node:fs/promises" {
  export * from "fs/promises";
}
