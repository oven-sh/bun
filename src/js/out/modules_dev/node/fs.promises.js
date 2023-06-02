var fs = Bun.fs(), notrace = "::bunternal::", promisify = {
  [notrace]: (fsFunction) => {
    var func = {
      [notrace]: function(resolve, reject, args) {
        var result;
        try {
          result = fsFunction.apply(fs, args), args = void 0;
        } catch (err) {
          args = void 0, reject(err);
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
}[notrace], access = promisify(fs.accessSync), appendFile = promisify(fs.appendFileSync), close = promisify(fs.closeSync), copyFile = promisify(fs.copyFileSync), exists = promisify(fs.existsSync), chown = promisify(fs.chownSync), chmod = promisify(fs.chmodSync), fchmod = promisify(fs.fchmodSync), fchown = promisify(fs.fchownSync), fstat = promisify(fs.fstatSync), fsync = promisify(fs.fsyncSync), ftruncate = promisify(fs.ftruncateSync), futimes = promisify(fs.futimesSync), lchmod = promisify(fs.lchmodSync), lchown = promisify(fs.lchownSync), link = promisify(fs.linkSync), lstat = promisify(fs.lstatSync), mkdir = promisify(fs.mkdirSync), mkdtemp = promisify(fs.mkdtempSync), open = promisify(fs.openSync), read = promisify(fs.readSync), write = promisify(fs.writeSync), readdir = promisify(fs.readdirSync), readFile = promisify(fs.readFileSync), writeFile = promisify(fs.writeFileSync), readlink = promisify(fs.readlinkSync), realpath = promisify(fs.realpathSync), rename = promisify(fs.renameSync), stat = promisify(fs.statSync), symlink = promisify(fs.symlinkSync), truncate = promisify(fs.truncateSync), unlink = promisify(fs.unlinkSync), utimes = promisify(fs.utimesSync), lutimes = promisify(fs.lutimesSync), rm = promisify(fs.rmSync), rmdir = promisify(fs.rmdirSync), fs_promises_default = {
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

//# debugId=B40B3CF26A232CDD64756e2164756e21
