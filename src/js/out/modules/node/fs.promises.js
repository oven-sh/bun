// src/js/node/fs.promises.js
var fs = Bun.fs();
var notrace = "::bunternal::";
var promisify = {
  [notrace]: (fsFunction) => {
    var func = {
      [notrace]: function(resolve, reject, args) {
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
      }
    }[notrace];
    return async function(...args) {
      return await new Promise((resolve, reject) => {
        process.nextTick(func, resolve, reject, args);
      });
    };
  }
}[notrace];
var access = promisify(fs.accessSync);
var appendFile = promisify(fs.appendFileSync);
var close = promisify(fs.closeSync);
var copyFile = promisify(fs.copyFileSync);
var exists = promisify(fs.existsSync);
var chown = promisify(fs.chownSync);
var chmod = promisify(fs.chmodSync);
var fchmod = promisify(fs.fchmodSync);
var fchown = promisify(fs.fchownSync);
var fstat = promisify(fs.fstatSync);
var fsync = promisify(fs.fsyncSync);
var ftruncate = promisify(fs.ftruncateSync);
var futimes = promisify(fs.futimesSync);
var lchmod = promisify(fs.lchmodSync);
var lchown = promisify(fs.lchownSync);
var link = promisify(fs.linkSync);
var lstat = promisify(fs.lstatSync);
var mkdir = promisify(fs.mkdirSync);
var mkdtemp = promisify(fs.mkdtempSync);
var open = promisify(fs.openSync);
var read = promisify(fs.readSync);
var write = promisify(fs.writeSync);
var readdir = promisify(fs.readdirSync);
var readFile = promisify(fs.readFileSync);
var writeFile = promisify(fs.writeFileSync);
var readlink = promisify(fs.readlinkSync);
var realpath = promisify(fs.realpathSync);
var rename = promisify(fs.renameSync);
var stat = promisify(fs.statSync);
var symlink = promisify(fs.symlinkSync);
var truncate = promisify(fs.truncateSync);
var unlink = promisify(fs.unlinkSync);
var utimes = promisify(fs.utimesSync);
var lutimes = promisify(fs.lutimesSync);
var rm = promisify(fs.rmSync);
var rmdir = promisify(fs.rmdirSync);
var fs_promises_default = {
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
  [Symbol.for("CommonJS")]: 0
};
export {
  writeFile,
  write,
  utimes,
  unlink,
  truncate,
  symlink,
  stat,
  rmdir,
  rm,
  rename,
  realpath,
  readlink,
  readdir,
  readFile,
  read,
  open,
  mkdtemp,
  mkdir,
  lutimes,
  lstat,
  link,
  lchown,
  lchmod,
  futimes,
  ftruncate,
  fsync,
  fstat,
  fchown,
  fchmod,
  exists,
  fs_promises_default as default,
  copyFile,
  close,
  chown,
  chmod,
  appendFile,
  access
};

//# debugId=F69C3C1ADE4269E864756e2164756e21
