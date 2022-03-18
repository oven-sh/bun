var fs = Bun.fs();

export function access(...args) {
  callbackify(fs.accessSync, args);
}
export function appendFile(...args) {
  callbackify(fs.appendFileSync, args);
}
export function close(...args) {
  callbackify(fs.closeSync, args);
}
export function copyFile(...args) {
  callbackify(fs.copyFileSync, args);
}
export function exists(...args) {
  callbackify(fs.existsSync, args);
}
export function chown(...args) {
  callbackify(fs.chownSync, args);
}
export function chmod(...args) {
  callbackify(fs.chmodSync, args);
}
export function fchmod(...args) {
  callbackify(fs.fchmodSync, args);
}
export function fchown(...args) {
  callbackify(fs.fchownSync, args);
}
export function fstat(...args) {
  callbackify(fs.fstatSync, args);
}
export function fsync(...args) {
  callbackify(fs.fsyncSync, args);
}
export function ftruncate(...args) {
  callbackify(fs.ftruncateSync, args);
}
export function futimes(...args) {
  callbackify(fs.futimesSync, args);
}
export function lchmod(...args) {
  callbackify(fs.lchmodSync, args);
}
export function lchown(...args) {
  callbackify(fs.lchownSync, args);
}
export function link(...args) {
  callbackify(fs.linkSync, args);
}
export function lstat(...args) {
  callbackify(fs.lstatSync, args);
}
export function mkdir(...args) {
  callbackify(fs.mkdirSync, args);
}
export function mkdtemp(...args) {
  callbackify(fs.mkdtempSync, args);
}
export function open(...args) {
  callbackify(fs.openSync, args);
}
export function read(...args) {
  callbackify(fs.readSync, args);
}
export function write(...args) {
  callbackify(fs.writeSync, args);
}
export function readdir(...args) {
  callbackify(fs.readdirSync, args);
}
export function readFile(...args) {
  callbackify(fs.readFileSync, args);
}
export function writeFile(...args) {
  callbackify(fs.writeFileSync, args);
}
export function readlink(...args) {
  callbackify(fs.readlinkSync, args);
}
export function realpath(...args) {
  callbackify(fs.realpathSync, args);
}
export function rename(...args) {
  callbackify(fs.renameSync, args);
}
export function stat(...args) {
  callbackify(fs.statSync, args);
}
export function symlink(...args) {
  callbackify(fs.symlinkSync, args);
}
export function truncate(...args) {
  callbackify(fs.truncateSync, args);
}
export function unlink(...args) {
  callbackify(fs.unlinkSync, args);
}
export function utimes(...args) {
  callbackify(fs.utimesSync, args);
}
export function lutimes(...args) {
  callbackify(fs.lutimesSync, args);
}

function callbackify(fsFunction, args) {
  queueMicrotask(function () {
    try {
      args[args.length - 1](
        null,
        fsFunction.apply(fs, args.slice(0, args.length - 1))
      );
    } catch (err) {
      args[args.length - 1](err);
    } finally {
      // ensure we don't leak it
      args = null;
    }
  });
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

export var createReadStream = fs.createReadStream.bind(fs);
export var createWriteStream = fs.createWriteStream.bind(fs);

// todo: rest of these
export var constants = {
  COPYFILE_EXCL: 1 << 1,
  COPYFILE_FICLONE: 1 << 2,
  COPYFILE_FICLONE_FORCE: 1 << 4,
};

// lol
realpath.native = realpath;
realpathSync.native = realpathSync;

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
};
