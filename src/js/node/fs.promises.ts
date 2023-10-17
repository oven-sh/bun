import type { Dirent } from "fs";

// Hardcoded module "node:fs/promises"
const constants = $processBindingConstants.fs;

var fs = Bun.fs();

// note: this is not quite the same as how node does it
// in some cases, node swaps around arguments or makes small tweaks to the return type
// this is just better than nothing.
const notrace = "::bunternal::";

function watch(
  filename: string | Buffer | URL,
  options: { encoding?: BufferEncoding; persistent?: boolean; recursive?: boolean; signal?: AbortSignal } = {},
) {
  type Event = {
    eventType: string;
    filename: string | Buffer | undefined;
  };

  if (filename instanceof URL) {
    throw new TypeError("Watch URLs are not supported yet");
  } else if (Buffer.isBuffer(filename)) {
    filename = filename.toString();
  } else if (typeof filename !== "string") {
    throw new TypeError("Expected path to be a string or Buffer");
  }
  let nextEventResolve: Function | null = null;
  if (typeof options === "string") {
    options = { encoding: options };
  }
  const queue = $createFIFO();

  const watcher = fs.watch(filename, options || {}, (eventType: string, filename: string | Buffer | undefined) => {
    queue.push({ eventType, filename });
    if (nextEventResolve) {
      const resolve = nextEventResolve;
      nextEventResolve = null;
      resolve();
    }
  });

  return {
    [Symbol.asyncIterator]() {
      let closed = false;
      return {
        async next() {
          while (!closed) {
            let event: Event;
            while ((event = queue.shift() as Event)) {
              if (event.eventType === "close") {
                closed = true;
                return { value: undefined, done: true };
              }
              if (event.eventType === "error") {
                closed = true;
                throw event.filename;
              }
              return { value: event, done: false };
            }
            const { promise, resolve } = Promise.withResolvers();
            nextEventResolve = resolve;
            await promise;
          }
          return { value: undefined, done: true };
        },

        return() {
          if (!closed) {
            watcher.close();
            closed = true;
            if (nextEventResolve) {
              const resolve = nextEventResolve;
              nextEventResolve = null;
              resolve();
            }
          }
          return { value: undefined, done: true };
        },
      };
    },
  };
}

let lazy_cp: any = null;
// attempt to use the native code version if possible
// and on MacOS, simple cases of recursive directory trees can be done in a single `clonefile()`
// using filter and other options uses a lazily loaded js fallback ported from node.js
function cp(src, dest, options) {
  if (!options) return fs.cp(src, dest);
  if (typeof options !== "object") {
    throw new TypeError("options must be an object");
  }
  if (options.dereference || options.filter || options.preserveTimestamps || options.verbatimSymlinks) {
    if (!lazy_cp) lazy_cp = require("../internal/fs/cp-sync");
    return lazy_cp!(src, dest, options);
  }
  return fs.cp(src, dest, options.recursive, options.errorOnExist, options.force ?? true, options.mode);
}

// TODO: implement this in native code using a Dir Iterator 💀
// This is currently stubbed for Next.js support.
class Dir {
  #entries: Dirent[];
  constructor(e: Dirent[]) {
    this.#entries = e;
  }
  readSync() {
    return this.#entries.shift() ?? null;
  }
  read(c) {
    if (c) process.nextTick(c, null, this.readSync());
    return Promise.resolve(this.readSync());
  }
  closeSync() {}
  close(c) {
    if (c) process.nextTick(c);
    return Promise.resolve();
  }
  *[Symbol.asyncIterator]() {
    var next;
    while ((next = this.readSync())) {
      yield next;
    }
  }
}
async function opendir(dir: string) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return new Dir(entries);
}

export default {
  access: fs.access.bind(fs),
  appendFile: fs.appendFile.bind(fs),
  close: fs.close.bind(fs),
  copyFile: fs.copyFile.bind(fs),
  cp,
  exists: fs.exists.bind(fs),
  chown: fs.chown.bind(fs),
  chmod: fs.chmod.bind(fs),
  fchmod: fs.fchmod.bind(fs),
  fchown: fs.fchown.bind(fs),
  fstat: fs.fstat.bind(fs),
  fsync: fs.fsync.bind(fs),
  ftruncate: fs.ftruncate.bind(fs),
  futimes: fs.futimes.bind(fs),
  lchmod: fs.lchmod.bind(fs),
  lchown: fs.lchown.bind(fs),
  link: fs.link.bind(fs),
  lstat: fs.lstat.bind(fs),
  mkdir: fs.mkdir.bind(fs),
  mkdtemp: fs.mkdtemp.bind(fs),
  open: fs.open.bind(fs),
  read: fs.read.bind(fs),
  write: fs.write.bind(fs),
  readdir: fs.readdir.bind(fs),
  readFile: fs.readFile.bind(fs),
  writeFile: fs.writeFile.bind(fs),
  readlink: fs.readlink.bind(fs),
  realpath: fs.realpath.bind(fs),
  rename: fs.rename.bind(fs),
  stat: fs.stat.bind(fs),
  symlink: fs.symlink.bind(fs),
  truncate: fs.truncate.bind(fs),
  unlink: fs.unlink.bind(fs),
  utimes: fs.utimes.bind(fs),
  lutimes: fs.lutimes.bind(fs),
  rm: fs.rm.bind(fs),
  rmdir: fs.rmdir.bind(fs),
  writev: async (fd, buffers, position) => {
    var bytesWritten = await fs.writev(fd, buffers, position);
    return {
      bytesWritten,
      buffers,
    };
  },
  readv: async (fd, buffers, position) => {
    var bytesRead = await fs.readv(fd, buffers, position);

    return {
      bytesRead,
      buffers,
    };
  },
  constants,
  watch,

  opendir,
};
