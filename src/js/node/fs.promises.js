// Hardcoded module "node:fs/promises"
// Note: `constants` is injected into the top of this file

var fs = Bun.fs();

// note: this is not quite the same as how node does it
// in some cases, node swaps around arguments or makes small tweaks to the return type
// this is just better than nothing.
const notrace = "::bunternal::";
var promisify = {
  [notrace]: fsFunction => {
    // TODO: remove variadic arguments
    // we can use new Function() here instead
    // based on fsFucntion.length
    var func = {
      [notrace]: function (resolve, reject, args) {
        var result;
        try {
          result = fsFunction.apply(fs, args);
          args = undefined;
        } catch (err) {
          args = undefined;
          reject(err);
          return;
        }

        resolve(result);
      },
    }[notrace];

    return async function (...args) {
      // we await it so that the stack is captured
      return await new Promise((resolve, reject) => {
        process.nextTick(func, resolve, reject, args);
      });
    };
  },
}[notrace];

export var access = promisify(fs.accessSync),
  appendFile = promisify(fs.appendFileSync),
  close = promisify(fs.closeSync),
  copyFile = promisify(fs.copyFileSync),
  exists = promisify(fs.existsSync),
  chown = promisify(fs.chownSync),
  chmod = promisify(fs.chmodSync),
  fchmod = promisify(fs.fchmodSync),
  fchown = promisify(fs.fchownSync),
  fstat = promisify(fs.fstatSync),
  fsync = promisify(fs.fsyncSync),
  ftruncate = promisify(fs.ftruncateSync),
  futimes = promisify(fs.futimesSync),
  lchmod = promisify(fs.lchmodSync),
  lchown = promisify(fs.lchownSync),
  link = promisify(fs.linkSync),
  lstat = promisify(fs.lstatSync),
  mkdir = promisify(fs.mkdirSync),
  mkdtemp = promisify(fs.mkdtempSync),
  open = promisify(fs.openSync),
  read = promisify(fs.readSync),
  write = promisify(fs.writeSync),
  readdir = promisify(fs.readdirSync),
  readFile = promisify(fs.readFileSync),
  writeFile = promisify(fs.writeFileSync),
  readlink = promisify(fs.readlinkSync),
  realpath = promisify(fs.realpathSync),
  rename = promisify(fs.renameSync),
  stat = promisify(fs.statSync),
  symlink = promisify(fs.symlinkSync),
  truncate = promisify(fs.truncateSync),
  unlink = promisify(fs.unlinkSync),
  utimes = promisify(fs.utimesSync),
  lutimes = promisify(fs.lutimesSync),
  rm = promisify(fs.rmSync),
  rmdir = promisify(fs.rmdirSync);

export default {
  access,
  appendFile,
  close,
  copyFile,
  exists,
  chown,
  chmod,
  fchmod,
  fchown,
  fstat,
  fsync,
  ftruncate,
  futimes,
  lchmod,
  lchown,
  link,
  lstat,
  mkdir,
  mkdtemp,
  open,
  read,
  write,
  readdir,
  readFile,
  writeFile,
  readlink,
  realpath,
  rename,
  stat,
  symlink,
  truncate,
  unlink,
  utimes,
  lutimes,
  rm,
  rmdir,
  constants,
  [Symbol.for("CommonJS")]: 0,
};
