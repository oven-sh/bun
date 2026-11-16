// The origin private file system. https://fs.spec.whatwg.org/
const idl = require("internal/desktop/web/idl");

const { error, expose, internal, need, scope, usv } = idl;
const fs = scope.env.fs();
let base: string | undefined;

/** The names on disk have nothing that a file system could refuse, or mistake for another name. */
const onDisk = (names: string[]) =>
  [(base ??= scope.env.originDirectory()), ...names.map(name => Buffer.from(name).hexSlice())].join("/");
const kindOf = (path: string) => {
  const stat = fs.statSync(path, { throwIfNoEntry: false });
  return stat && (stat.isDirectory() ? "directory" : "file");
};

function validName(given: unknown) {
  const name = usv(given);
  if (/^\.{0,2}$|[\\/]/.test(name) || Buffer.byteLength(name) > 100) throw new TypeError("Name is not allowed.");
  return name;
}

const notFound = () => error("NotFoundError", "A requested file or directory could not be found.");
const locked = () => error("NoModificationAllowedError", "The file or directory is locked.");

/** A lock of the session, for all threads. The result releases it. */
async function lock(path: string, mode: string): Promise<() => void> {
  const { held } = await scope.env.queryLocks(true);
  const isRelated = (other: string) => other === path || other.startsWith(path + "/") || path.startsWith(other + "/");
  const conflicts = ({ name }: any) => isRelated(name.split("\n")[1]) && (mode === "" || name.split("\n")[0] !== mode);
  if (held.some(conflicts)) throw locked();
  const { promise, resolve } = Promise.withResolvers<void>();
  const request = scope.env.requestFileLock(`${mode}\n${path}`, resolve);
  const release = () => void (scope.cleanups.delete(release) && request.release());
  scope.cleanups.add(release);
  await promise;
  return release;
}

let turn: Promise<unknown> = Promise.$resolve();

/** One after the other. */
function inTurn<T>(run: () => T | Promise<T>): Promise<T> {
  const result = turn.then(run);
  turn = result.then(undefined, () => {});
  return result;
}

async function removeEntry(names: string[], recursive: boolean) {
  const path = onDisk(names);
  const release = await lock(path, "");
  try {
    const kind = kindOf(path);
    if (!kind) throw notFound();
    if (kind === "directory" && !recursive && fs.readdirSync(path).length > 0) {
      throw error("InvalidModificationError", "The directory is not empty.");
    }
    fs.rmSync(path, { recursive: true });
    if (names.length === 0) fs.mkdirSync(path);
  } finally {
    release();
  }
}

let namesOf: (handle: any) => string[];

class FileSystemHandle {
  #kind: string;
  #names: string[];

  constructor(key: unknown = undefined, kind = "", names: string[] = []) {
    idl.illegal(key);
    this.#kind = kind;
    this.#names = names;
  }

  static {
    namesOf = handle => handle.#names;
    idl.serializable(this.prototype, handle => ({
      kind: "FileSystemHandle",
      type: handle.#kind,
      names: handle.#names,
      origin: scope.env.origin,
    }));
  }

  get kind() {
    return this.#kind;
  }
  get name() {
    return this.#names.at(-1) ?? "";
  }

  async isSameEntry(other: FileSystemHandle) {
    return this.#kind === other.#kind && this.#names.join("/") === other.#names.join("/");
  }
  async queryPermission() {
    return "granted";
  }
  async requestPermission() {
    return "granted";
  }
  async remove(options: unknown = undefined) {
    const { recursive } = idl.dictionary(options);
    return inTurn(() => removeEntry(this.#names, !!recursive || this.#names.length === 0));
  }
}

function existingFile(handle: object) {
  const path = onDisk(namesOf(handle));
  if (kindOf(path) !== "file") throw notFound();
  return path;
}

class FileSystemFileHandle extends FileSystemHandle {
  async getFile() {
    const path = existingFile(this);
    const options = { type: scope.env.typeOfFile(this.name), lastModified: Math.floor(fs.statSync(path).mtimeMs) };
    return new File([fs.readFileSync(path)], this.name, options);
  }

  async createWritable(options: unknown = undefined) {
    const { keepExistingData, mode = "siloed" } = idl.dictionary(options);
    const isExclusive = idl.oneOf(mode, ["exclusive", "siloed"]) === "exclusive";
    return inTurn(async () => {
      const path = existingFile(this);
      const release = await lock(path, isExclusive ? "" : "siloed");
      return new FileSystemWritableFileStream(internal, path, !!keepExistingData, release);
    });
  }

  async createSyncAccessHandle(options: unknown = undefined) {
    const mode = idl.oneOf(idl.dictionary(options).mode ?? "readwrite", ["readwrite", "read-only", "readwrite-unsafe"]);
    return inTurn(async () => {
      const path = existingFile(this);
      return new FileSystemSyncAccessHandle(internal, path, mode, await lock(path, mode === "readwrite" ? "" : mode));
    });
  }

  async move(destination: any, name: unknown = undefined) {
    need(arguments.length, 1);
    const names = namesOf(this);
    const isRename = !(destination instanceof FileSystemDirectoryHandle);
    const target = [
      ...(isRename ? names.slice(0, -1) : namesOf(destination)),
      validName(isRename ? destination : (name ?? this.name)),
    ];
    return inTurn(async () => {
      const [from, to] = [onDisk(names), onDisk(target)];
      const releases = [await lock(from, "")];
      try {
        if (from !== to) releases.push(await lock(to, ""));
        if (kindOf(from) !== "file" || kindOf(onDisk(target.slice(0, -1))) !== "directory") throw notFound();
        if (kindOf(to) === "directory") throw error("InvalidModificationError", "There is a directory of that name.");
        fs.renameSync(from, to);
        names.splice(0, Infinity, ...target);
      } finally {
        for (const release of releases) release();
      }
    });
  }
}
if (scope.isWindow || scope.env.isShared) delete (FileSystemFileHandle.prototype as any).createSyncAccessHandle;

const handleFor = (kind: string, names: string[]) =>
  new (kind === "file" ? FileSystemFileHandle : FileSystemDirectoryHandle)(internal, kind, names);

async function* children(handle: object, pick: (name: string, child: object) => unknown) {
  const names = namesOf(handle);
  if (kindOf(onDisk(names)) !== "directory") throw notFound();
  for (const entry of fs.readdirSync(onDisk(names), { withFileTypes: true })) {
    if (entry.name.includes(".")) continue;
    const name = Buffer.from(entry.name, "hex").toString();
    yield pick(name, handleFor(entry.isDirectory() ? "directory" : "file", [...names, name]));
  }
}

class FileSystemDirectoryHandle extends FileSystemHandle {
  #child(kind: string, name: unknown, options: unknown) {
    const { create } = idl.dictionary(options);
    const names = [...namesOf(this), validName(name)];
    const path = onDisk(names);
    const found = kindOf(path);
    if (found && found !== kind) throw error("TypeMismatchError", "The entry is not of the expected type.");
    if (!found && (!create || kindOf(onDisk(namesOf(this))) !== "directory")) throw notFound();
    if (!found && kind === "file") fs.writeFileSync(path, "");
    else if (!found) fs.mkdirSync(path);
    return handleFor(kind, names);
  }

  async getFileHandle(name: string, options: unknown = undefined) {
    need(arguments.length, 1);
    return this.#child("file", name, options);
  }
  async getDirectoryHandle(name: string, options: unknown = undefined) {
    need(arguments.length, 1);
    return this.#child("directory", name, options);
  }
  async removeEntry(name: string, options: unknown = undefined) {
    need(arguments.length, 1);
    const names = [...namesOf(this), validName(name)];
    const { recursive } = idl.dictionary(options);
    return inTurn(() => removeEntry(names, !!recursive));
  }
  async resolve(descendant: FileSystemHandle) {
    const [own, other] = [namesOf(this), namesOf(descendant)];
    return own.every((name, i) => name === other[i]) ? other.slice(own.length) : null;
  }
  entries() {
    return children(this, (name, child) => [name, child]);
  }
  keys() {
    return children(this, name => name);
  }
  values() {
    return children(this, (_, child) => child);
  }
}
Object.defineProperty(FileSystemDirectoryHandle.prototype, Symbol.asyncIterator, {
  value: FileSystemDirectoryHandle.prototype.entries,
  writable: true,
  configurable: true,
});

const isBlob = (value: unknown) => $inheritsBlob(value);
const MAX_SIZE = 2 ** 36;

function requireRoom(size: number) {
  if (size > MAX_SIZE) throw error("QuotaExceededError", "The operation would exceed the storage quota.");
}

class FileSystemWritableFileStream extends WritableStream {
  constructor(key: unknown = undefined, path = "", keepsData = false, release = () => {}) {
    idl.illegal(key);
    const swap = `${path}.${crypto.randomUUID()}`;
    if (keepsData) fs.copyFileSync(path, swap);
    const file = fs.openSync(swap, keepsData ? "r+" : "w");
    let position = 0;
    const end = (keeps: boolean) => {
      if (!scope.cleanups.delete(discard)) return;
      fs.closeSync(file);
      if (keeps && kindOf(path) === "file") fs.renameSync(swap, path);
      else fs.rmSync(swap, { force: true });
      release();
    };
    const discard = () => end(false);
    scope.cleanups.add(discard);
    const apply = async (chunk: any) => {
      const isCommand = $isObject(chunk) ? !isBlob(chunk) && !idl.bytesOf(chunk) : chunk == null;
      const {
        data,
        position: at = null,
        size = null,
        type,
      } = isCommand ? idl.dictionary(chunk) : { data: chunk, type: "write" };
      const command = idl.oneOf(type, ["write", "seek", "truncate"]);
      const isComplete = command === "write" ? data !== undefined : (command === "seek" ? at : size) !== null;
      if (!isComplete) throw error("SyntaxError", `${command} lacks an argument.`);
      if (command === "seek") return void (position = idl.unsignedLongLong(at));
      if (command === "truncate") {
        requireRoom(idl.unsignedLongLong(size));
        fs.ftruncateSync(file, idl.unsignedLongLong(size));
        return void (position = Math.min(position, idl.unsignedLongLong(size)));
      }
      if (data === null) throw new TypeError("write requires data that is not null.");
      const bytes = isBlob(data)
        ? await data.bytes()
        : ($isObject(data) && idl.bytesOf(data)) || Buffer.from(usv(data));
      if (at !== null) position = idl.unsignedLongLong(at);
      requireRoom(position + bytes.length);
      if (position > fs.fstatSync(file).size) fs.ftruncateSync(file, position);
      position += fs.writeSync(file, bytes, 0, bytes.length, position);
    };
    super({
      write: chunk =>
        apply(chunk).then(undefined, failure => {
          discard();
          throw failure;
        }),
      close: () => end(true),
      abort: discard,
    });
  }

  #send(chunk: unknown) {
    const writer = WritableStream.prototype.getWriter.$call(this);
    const result = writer.write(chunk);
    writer.releaseLock();
    return result;
  }

  async write(data: unknown) {
    need(arguments.length, 1);
    return this.#send(data);
  }
  async seek(position: number) {
    need(arguments.length, 1);
    return this.#send({ type: "seek", position: idl.unsignedLongLong(position) });
  }
  async truncate(size: number) {
    need(arguments.length, 1);
    return this.#send({ type: "truncate", size: idl.unsignedLongLong(size) });
  }
}

class FileSystemSyncAccessHandle {
  #file: number | undefined;
  #mode: string;
  #position = 0;
  #release: () => void;

  constructor(key: unknown = undefined, path = "", mode = "", release = () => {}) {
    idl.illegal(key);
    this.#file = fs.openSync(path, "r+");
    this.#mode = mode;
    this.#release = release;
  }

  #open(writes = false) {
    if (this.#file === undefined) throw error("InvalidStateError", "The access handle was already closed.");
    if (writes && this.#mode === "read-only") throw locked();
    return this.#file;
  }

  #transfer(operation: Function, buffer: any, options: unknown, writes: boolean) {
    const isView = ArrayBuffer.isView(buffer);
    if (!isView && !require("node:util/types").isAnyArrayBuffer(buffer))
      throw new TypeError("parameter 1 is not a buffer.");
    const bytes = isView ? new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength) : new Uint8Array(buffer);
    const { at } = idl.dictionary(options);
    const position = at === undefined ? this.#position : idl.inRange(at);
    const file = this.#open(writes);
    const { size } = fs.fstatSync(file);
    if (writes) requireRoom(position + bytes.length);
    if (writes && position > size) fs.ftruncateSync(file, position);
    const count = operation(file, bytes, 0, bytes.length, position);
    this.#position = writes ? position + count : Math.min(position + count, size);
    return count;
  }

  get mode() {
    return this.#mode;
  }

  read(buffer: unknown, options: unknown = undefined) {
    return this.#transfer(fs.readSync, buffer, options, false);
  }
  write(buffer: unknown, options: unknown = undefined) {
    return this.#transfer(fs.writeSync, buffer, options, true);
  }
  truncate(size: number) {
    need(arguments.length, 1);
    size = idl.inRange(size);
    const file = this.#open(true);
    requireRoom(size);
    fs.ftruncateSync(file, size);
    this.#position = Math.min(this.#position, size);
  }
  getSize() {
    return fs.fstatSync(this.#open()).size;
  }
  flush() {
    fs.fsyncSync(this.#open(true));
  }
  close() {
    if (this.#file === undefined) return;
    fs.closeSync(this.#file);
    this.#file = undefined;
    this.#release();
  }
}

const interfaces = {
  FileSystemDirectoryHandle,
  FileSystemFileHandle,
  FileSystemHandle,
  FileSystemSyncAccessHandle,
  FileSystemWritableFileStream,
};
for (const it of [FileSystemDirectoryHandle, FileSystemFileHandle]) {
  idl.serializable(it.prototype, $getByIdDirectPrivate(FileSystemHandle.prototype, "cloner"));
}
for (const it of Object.values(interfaces)) expose(it);

function deserialize({ type, names, origin }: any) {
  if (origin !== scope.env.origin) throw error("DataCloneError", "A handle cannot go to another origin.");
  return handleFor(type, names);
}

export default { ...interfaces, deserialize, root: () => handleFor("directory", []) };
