(function (){"use strict";// build3/tmp/node/fs.promises.ts
var watch = function(filename, options = {}) {
  if (filename instanceof URL) {
    @throwTypeError("Watch URLs are not supported yet");
  } else if (@Buffer.isBuffer(filename)) {
    filename = filename.toString();
  } else if (typeof filename !== "string") {
    @throwTypeError("Expected path to be a string or Buffer");
  }
  let nextEventResolve = null;
  if (typeof options === "string") {
    options = { encoding: options };
  }
  const queue = @createFIFO();
  const watcher = fs.watch(filename, options || {}, (eventType, filename2) => {
    queue.push({ eventType, filename: filename2 });
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
            let event;
            while (event = queue.shift()) {
              if (event.eventType === "close") {
                closed = true;
                return { value: @undefined, done: true };
              }
              if (event.eventType === "error") {
                closed = true;
                throw event.filename;
              }
              return { value: event, done: false };
            }
            const { promise, resolve } = @Promise.withResolvers();
            nextEventResolve = resolve;
            await promise;
          }
          return { value: @undefined, done: true };
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
          return { value: @undefined, done: true };
        }
      };
    }
  };
};
var cp = function(src, dest, options) {
  if (!options)
    return fs.cp(src, dest);
  if (typeof options !== "object") {
    @throwTypeError("options must be an object");
  }
  if (options.dereference || options.filter || options.preserveTimestamps || options.verbatimSymlinks) {
    if (!lazy_cp)
      lazy_cp = @getInternalField(@internalModuleRegistry, 3) || @createInternalModuleById(3);
    return lazy_cp(src, dest, options);
  }
  return fs.cp(src, dest, options.recursive, options.errorOnExist, options.force ?? true, options.mode);
};
async function opendir(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return new Dir(entries);
}
var $;
var constants = @processBindingConstants.fs;
var fs = Bun.fs();
var lazy_cp = null;

class Dir {
  #entries;
  constructor(e) {
    this.#entries = e;
  }
  readSync() {
    return this.#entries.shift() ?? null;
  }
  read(c) {
    if (c)
      process.nextTick(c, null, this.readSync());
    return @Promise.resolve(this.readSync());
  }
  closeSync() {
  }
  close(c) {
    if (c)
      process.nextTick(c);
    return @Promise.resolve();
  }
  *[Symbol.asyncIterator]() {
    var next;
    while (next = this.readSync()) {
      yield next;
    }
  }
}
$ = {
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
      buffers
    };
  },
  readv: async (fd, buffers, position) => {
    var bytesRead = await fs.readv(fd, buffers, position);
    return {
      bytesRead,
      buffers
    };
  },
  constants,
  watch,
  opendir
};
return $})
