var fs = Bun.fs();

var _stat = fs.statSync;
fs.statSync = function (path) {
  console.trace("stat", path);
  return _stat(path);
};

// note: this is not quite the same as how node does it
// in some cases, node swaps around arguments or makes small tweaks to the return type
// this is just better than nothing.
function promisify(fsFunction) {
  // TODO: remove variadic arguments
  // we can use new Function() here instead
  // based on fsFucntion.length
  var obj = {
    [fsFunction.name]: function (resolve, reject, args) {
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
  };

  var func = obj[fsFunction.name];

  // TODO: consider @createPromiseCapabiilty intrinsic
  return (...args) => {
    return new Promise((resolve, reject) => {
      func(resolve, reject, args);
    });
  };
}

export var access = promisify(fs.accessSync);
export var appendFile = promisify(fs.appendFileSync);
export var close = promisify(fs.closeSync);
export var copyFile = promisify(fs.copyFileSync);
export var exists = promisify(fs.existsSync);
export var chown = promisify(fs.chownSync);
export var chmod = promisify(fs.chmodSync);
export var fchmod = promisify(fs.fchmodSync);
export var fchown = promisify(fs.fchownSync);
export var fstat = promisify(fs.fstatSync);
export var fsync = promisify(fs.fsyncSync);
export var ftruncate = promisify(fs.ftruncateSync);
export var futimes = promisify(fs.futimesSync);
export var lchmod = promisify(fs.lchmodSync);
export var lchown = promisify(fs.lchownSync);
export var link = promisify(fs.linkSync);
export var lstat = promisify(fs.lstatSync);
export var mkdir = promisify(fs.mkdirSync);
export var mkdtemp = promisify(fs.mkdtempSync);
export var open = promisify(fs.openSync);
export var read = promisify(fs.readSync);
export var write = promisify(fs.writeSync);
export var readdir = promisify(fs.readdirSync);
export var readFile = promisify(fs.readFileSync);
export var readfile = readFile;
export var writeFile = promisify(fs.writeFileSync);
export var readlink = promisify(fs.readlinkSync);
export var realpath = promisify(fs.realpathSync);
export var rename = promisify(fs.renameSync);
export var stat = promisify(fs.statSync);
export var symlink = promisify(fs.symlinkSync);
export var truncate = promisify(fs.truncateSync);
export var unlink = promisify(fs.unlinkSync);
export var utimes = promisify(fs.utimesSync);
export var lutimes = promisify(fs.lutimesSync);
export var rm = promisify(fs.rmSync);

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
  readfile,
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

  [Symbol.for("CommonJS")]: 0,
};
