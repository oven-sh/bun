// Hardcoded module "node:fs/promises"

// Note: `constants` is injected into the top of this file
declare var constants: typeof import("node:fs/promises").constants;
const { createFIFO } = $lazy("primordials");

var fs = Bun.fs();

// note: this is not quite the same as how node does it
// in some cases, node swaps around arguments or makes small tweaks to the return type
// this is just better than nothing.
const notrace = "::bunternal::";
var promisify = {
  [notrace]: fsFunction => {
    return async function (...args) {
      await 1;
      return fsFunction.apply(fs, args);
    };
  },
}[notrace];

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
  const queue = createFIFO();

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
module.exports = {
  access: promisify(fs.accessSync),
  appendFile: promisify(fs.appendFileSync),
  close: promisify(fs.closeSync),
  copyFile: promisify(fs.copyFileSync),
  exists: promisify(fs.existsSync),
  chown: promisify(fs.chownSync),
  chmod: promisify(fs.chmodSync),
  fchmod: promisify(fs.fchmodSync),
  fchown: promisify(fs.fchownSync),
  fstat: promisify(fs.fstatSync),
  fsync: promisify(fs.fsyncSync),
  ftruncate: promisify(fs.ftruncateSync),
  futimes: promisify(fs.futimesSync),
  lchmod: promisify(fs.lchmodSync),
  lchown: promisify(fs.lchownSync),
  link: promisify(fs.linkSync),
  lstat: fs.lstat.bind(fs),
  mkdir: promisify(fs.mkdirSync),
  mkdtemp: promisify(fs.mkdtempSync),
  open: promisify(fs.openSync),
  read: promisify(fs.readSync),
  write: promisify(fs.writeSync),
  readdir: fs.readdir.bind(fs),
  readFile: fs.readFile.bind(fs),
  writeFile: promisify(fs.writeFileSync),
  readlink: promisify(fs.readlinkSync),
  realpath: promisify(fs.realpathSync),
  rename: promisify(fs.renameSync),
  stat: fs.stat.bind(fs),
  symlink: promisify(fs.symlinkSync),
  truncate: promisify(fs.truncateSync),
  unlink: promisify(fs.unlinkSync),
  utimes: promisify(fs.utimesSync),
  lutimes: promisify(fs.lutimesSync),
  rm: promisify(fs.rmSync),
  rmdir: promisify(fs.rmdirSync),
  writev: (fd, buffers, position) => {
    return new Promise((resolve, reject) => {
      try {
        var bytesWritten = fs.writevSync(fd, buffers, position);
      } catch (err) {
        reject(err);
        return;
      }

      resolve({
        bytesWritten,
        buffers,
      });
    });
  },
  readv: (fd, buffers, position) => {
    return new Promise((resolve, reject) => {
      try {
        var bytesRead = fs.readvSync(fd, buffers, position);
      } catch (err) {
        reject(err);
        return;
      }

      resolve({
        bytesRead,
        buffers,
      });
    });
  },
  constants,
  watch,
};
