var fs = Bun.fs();

export var access = function access(...args) {
  callbackify(fs.accessSync, args);
};
export var appendFile = function appendFile(...args) {
  callbackify(fs.appendFileSync, args);
};
export var close = function close(...args) {
  callbackify(fs.closeSync, args);
};
export var rm = function rm(...args) {
  callbackify(fs.rmSync, args);
};
export var copyFile = function copyFile(...args) {
  callbackify(fs.copyFileSync, args);
};
export var exists = function exists(...args) {
  callbackify(fs.existsSync, args);
};
export var chown = function chown(...args) {
  callbackify(fs.chownSync, args);
};
export var chmod = function chmod(...args) {
  callbackify(fs.chmodSync, args);
};
export var fchmod = function fchmod(...args) {
  callbackify(fs.fchmodSync, args);
};
export var fchown = function fchown(...args) {
  callbackify(fs.fchownSync, args);
};
export var fstat = function fstat(...args) {
  callbackify(fs.fstatSync, args);
};
export var fsync = function fsync(...args) {
  callbackify(fs.fsyncSync, args);
};
export var ftruncate = function ftruncate(...args) {
  callbackify(fs.ftruncateSync, args);
};
export var futimes = function futimes(...args) {
  callbackify(fs.futimesSync, args);
};
export var lchmod = function lchmod(...args) {
  callbackify(fs.lchmodSync, args);
};
export var lchown = function lchown(...args) {
  callbackify(fs.lchownSync, args);
};
export var link = function link(...args) {
  callbackify(fs.linkSync, args);
};
export var lstat = function lstat(...args) {
  callbackify(fs.lstatSync, args);
};
export var mkdir = function mkdir(...args) {
  callbackify(fs.mkdirSync, args);
};
export var mkdtemp = function mkdtemp(...args) {
  callbackify(fs.mkdtempSync, args);
};
export var open = function open(...args) {
  callbackify(fs.openSync, args);
};
export var read = function read(...args) {
  callbackify(fs.readSync, args);
};
export var write = function write(...args) {
  callbackify(fs.writeSync, args);
};
export var readdir = function readdir(...args) {
  callbackify(fs.readdirSync, args);
};
export var readFile = function readFile(...args) {
  callbackify(fs.readFileSync, args);
};
export var writeFile = function writeFile(...args) {
  callbackify(fs.writeFileSync, args);
};
export var readlink = function readlink(...args) {
  callbackify(fs.readlinkSync, args);
};
export var realpath = function realpath(...args) {
  callbackify(fs.realpathSync, args);
};
export var rename = function rename(...args) {
  callbackify(fs.renameSync, args);
};
export var stat = function stat(...args) {
  callbackify(fs.statSync, args);
};
export var symlink = function symlink(...args) {
  callbackify(fs.symlinkSync, args);
};
export var truncate = function truncate(...args) {
  callbackify(fs.truncateSync, args);
};
export var unlink = function unlink(...args) {
  callbackify(fs.unlinkSync, args);
};
export var utimes = function utimes(...args) {
  callbackify(fs.utimesSync, args);
};
export var lutimes = function lutimes(...args) {
  callbackify(fs.lutimesSync, args);
};

function callbackify(fsFunction, args) {

  try {
    const result = fsFunction.apply(fs, args.slice(0, args.length - 1));
    queueMicrotask(() => args[args.length - 1](null, result));
  } catch (e) {
    queueMicrotask(() => args[args.length - 1](e));
  }
}

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

export var accessSync = fs.accessSync.bind(fs);
export var appendFileSync = fs.appendFileSync.bind(fs);
export var closeSync = fs.closeSync.bind(fs);
export var copyFileSync = fs.copyFileSync.bind(fs);
export var existsSync = fs.existsSync.bind(fs);
export var chownSync = fs.chownSync.bind(fs);
export var chmodSync = fs.chmodSync.bind(fs);
export var fchmodSync = fs.fchmodSync.bind(fs);
export var fchownSync = fs.fchownSync.bind(fs);
export var fstatSync = fs.fstatSync.bind(fs);
export var fsyncSync = fs.fsyncSync.bind(fs);
export var ftruncateSync = fs.ftruncateSync.bind(fs);
export var futimesSync = fs.futimesSync.bind(fs);
export var lchmodSync = fs.lchmodSync.bind(fs);
export var lchownSync = fs.lchownSync.bind(fs);
export var linkSync = fs.linkSync.bind(fs);
export var lstatSync = fs.lstatSync.bind(fs);
export var mkdirSync = fs.mkdirSync.bind(fs);
export var mkdtempSync = fs.mkdtempSync.bind(fs);
export var openSync = fs.openSync.bind(fs);
export var readSync = fs.readSync.bind(fs);
export var writeSync = fs.writeSync.bind(fs);
export var readdirSync = fs.readdirSync.bind(fs);
export var readFileSync = fs.readFileSync.bind(fs);
export var writeFileSync = fs.writeFileSync.bind(fs);
export var readlinkSync = fs.readlinkSync.bind(fs);
export var realpathSync = fs.realpathSync.bind(fs);
export var renameSync = fs.renameSync.bind(fs);
export var statSync = fs.statSync.bind(fs);
export var symlinkSync = fs.symlinkSync.bind(fs);
export var truncateSync = fs.truncateSync.bind(fs);
export var unlinkSync = fs.unlinkSync.bind(fs);
export var utimesSync = fs.utimesSync.bind(fs);
export var lutimesSync = fs.lutimesSync.bind(fs);
export var rmSync = fs.rmSync.bind(fs);

export var createReadStream = fs.createReadStream.bind(fs);
export var createWriteStream = fs.createWriteStream.bind(fs);

export var promises = {
  access: promisify(fs.accessSync),
  appendFile: promisify(fs.appendFileSync),
  chmod: promisify(fs.chmodSync),
  chown: promisify(fs.chownSync),
  close: promisify(fs.closeSync),
  copyFile: promisify(fs.copyFileSync),
  exists: promisify(fs.existsSync),
  fchmod: promisify(fs.fchmodSync),
  fchown: promisify(fs.fchownSync),
  fstat: promisify(fs.fstatSync),
  fsync: promisify(fs.fsyncSync),
  ftruncate: promisify(fs.ftruncateSync),
  futimes: promisify(fs.futimesSync),
  lchmod: promisify(fs.lchmodSync),
  lchown: promisify(fs.lchownSync),
  link: promisify(fs.linkSync),
  lstat: promisify(fs.lstatSync),
  lutimes: promisify(fs.lutimesSync),
  mkdir: promisify(fs.mkdirSync),
  mkdtemp: promisify(fs.mkdtempSync),
  open: promisify(fs.openSync),
  read: promisify(fs.readSync),
  readdir: promisify(fs.readdirSync),
  readlink: promisify(fs.readlinkSync),
  realpath: promisify(fs.realpathSync),
  rename: promisify(fs.renameSync),
  rm: promisify(fs.rmSync),
  stat: promisify(fs.statSync),
  symlink: promisify(fs.symlinkSync),
  truncate: promisify(fs.truncateSync),
  unlink: promisify(fs.unlinkSync),
  utimes: promisify(fs.utimesSync),
  write: promisify(fs.writeSync),
  writeFile: promisify(fs.writeFileSync),
};

promises.readFile = promises.readfile = promisify(fs.readFileSync);

// lol
realpath.native = realpath;
realpathSync.native = realpathSync;

export default {
  [Symbol.for("CommonJS")]: 0,
  access,
  accessSync,
  appendFile,
  appendFileSync,
  chmod,
  chmodSync,
  chown,
  chownSync,
  close,
  closeSync,
  constants,
  copyFile,
  copyFileSync,
  createReadStream,
  createWriteStream,
  exists,
  existsSync,
  fchmod,
  fchmodSync,
  fchown,
  fchownSync,
  fstat,
  fstatSync,
  fsync,
  fsyncSync,
  ftruncate,
  ftruncateSync,
  futimes,
  futimesSync,
  lchmod,
  lchmodSync,
  lchown,
  lchownSync,
  link,
  linkSync,
  lstat,
  lstatSync,
  lutimes,
  lutimesSync,
  mkdir,
  mkdirSync,
  mkdtemp,
  mkdtempSync,
  open,
  openSync,
  promises,
  read,
  readFile,
  readFileSync,
  readSync,
  readdir,
  readdirSync,
  readlink,
  readlinkSync,
  realpath,
  realpathSync,
  rename,
  renameSync,
  rm,
  rmSync,
  stat,
  statSync,
  symlink,
  symlinkSync,
  truncate,
  truncateSync,
  unlink,
  unlinkSync,
  utimes,
  utimesSync,
  write,
  writeFile,
  writeFileSync,
  writeSync,
};
