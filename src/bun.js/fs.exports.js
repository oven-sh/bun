var _fs = Bun.fs();
var fs = Object.create(_fs);

export var access = function access(...args) {
  callbackify(fs.accessSync, args);
};
export var appendFile = function appendFile(...args) {
  callbackify(fs.appendFileSync, args);
};
export var close = function close(...args) {
  callbackify(fs.closeSync, args);
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
  queueMicrotask(function () {
    try {
      args[args.length - 1](
        null,
        fsFunction.apply(_fs, args.slice(0, args.length - 1))
      );
    } catch (err) {
      args[args.length - 1](err);
    } finally {
      // ensure we don't leak it
      args = null;
    }
  });
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
        result = fsFunction.apply(_fs, args);
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

export var accessSync = fs.accessSync.bind(_fs);
export var appendFileSync = fs.appendFileSync.bind(_fs);
export var closeSync = fs.closeSync.bind(_fs);
export var copyFileSync = fs.copyFileSync.bind(_fs);
export var existsSync = fs.existsSync.bind(_fs);
export var chownSync = fs.chownSync.bind(_fs);
export var chmodSync = fs.chmodSync.bind(_fs);
export var fchmodSync = fs.fchmodSync.bind(_fs);
export var fchownSync = fs.fchownSync.bind(_fs);
export var fstatSync = fs.fstatSync.bind(_fs);
export var fsyncSync = fs.fsyncSync.bind(_fs);
export var ftruncateSync = fs.ftruncateSync.bind(_fs);
export var futimesSync = fs.futimesSync.bind(_fs);
export var lchmodSync = fs.lchmodSync.bind(_fs);
export var lchownSync = fs.lchownSync.bind(_fs);
export var linkSync = fs.linkSync.bind(_fs);
export var lstatSync = fs.lstatSync.bind(_fs);
export var mkdirSync = fs.mkdirSync.bind(_fs);
export var mkdtempSync = fs.mkdtempSync.bind(_fs);
export var openSync = fs.openSync.bind(_fs);
export var readSync = fs.readSync.bind(_fs);
export var writeSync = fs.writeSync.bind(_fs);
export var readdirSync = fs.readdirSync.bind(_fs);
export var readFileSync = fs.readFileSync.bind(_fs);
export var writeFileSync = fs.writeFileSync.bind(_fs);
export var readlinkSync = fs.readlinkSync.bind(_fs);
export var realpathSync = fs.realpathSync.bind(_fs);
export var renameSync = fs.renameSync.bind(_fs);
export var statSync = fs.statSync.bind(_fs);
export var symlinkSync = fs.symlinkSync.bind(_fs);
export var truncateSync = fs.truncateSync.bind(_fs);
export var unlinkSync = fs.unlinkSync.bind(_fs);
export var utimesSync = fs.utimesSync.bind(_fs);
export var lutimesSync = fs.lutimesSync.bind(_fs);

export var createReadStream = fs.createReadStream.bind(_fs);
export var createWriteStream = fs.createWriteStream.bind(_fs);

export var promises = {
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
  lstat: promisify(fs.lstatSync),
  mkdir: promisify(fs.mkdirSync),
  mkdtemp: promisify(fs.mkdtempSync),
  open: promisify(fs.openSync),
  read: promisify(fs.readSync),
  write: promisify(fs.writeSync),
  readdir: promisify(fs.readdirSync),
  writeFile: promisify(fs.writeFileSync),
  readlink: promisify(fs.readlinkSync),
  realpath: promisify(fs.realpathSync),
  rename: promisify(fs.renameSync),
  stat: promisify(fs.statSync),
  symlink: promisify(fs.symlinkSync),
  truncate: promisify(fs.truncateSync),
  unlink: promisify(fs.unlinkSync),
  utimes: promisify(fs.utimesSync),
  lutimes: promisify(fs.lutimesSync),
};

promises.readFile = promises.readfile = promisify(fs.readFileSync);

// lol
realpath.native = realpath;
realpathSync.native = realpathSync;

var object = {
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
  accessSync,
  appendFileSync,
  closeSync,
  copyFileSync,
  existsSync,
  chownSync,
  chmodSync,
  fchmodSync,
  fchownSync,
  fstatSync,
  fsyncSync,
  ftruncateSync,
  futimesSync,
  lchmodSync,
  lchownSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readSync,
  writeSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  statSync,
  symlinkSync,
  truncateSync,
  unlinkSync,
  utimesSync,
  lutimesSync,
  createReadStream,
  createWriteStream,
  constants,
  promises,
};

var CJSInterop = () => object;
CJSInterop[Symbol.for("CommonJS")] = true;
export default CJSInterop;
