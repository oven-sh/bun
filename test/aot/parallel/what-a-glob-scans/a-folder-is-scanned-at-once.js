// scanSync() answers the object of a generator function of the library.
const folder = process.platform === "win32" ? "C:/Windows/System32/drivers/etc" : "/etc";
const glob = new Bun.Glob("hosts");
const found = glob.scanSync(folder);
console.log(
  typeof found,
  Object.prototype.toString.call(found),
  String(found[Symbol.iterator]() === found),
  typeof found.next,
);
const first = found.next();
console.log(String(first.done), first.value, String(found.next().done), String(found.next().value));
console.log([...glob.scanSync({ cwd: folder })].join(), [...glob.scanSync({ cwd: folder, absolute: true })].length);
console.log([...new Bun.Glob("no-file-has-this-name").scanSync(folder)].length, String(glob.match("hosts")));
