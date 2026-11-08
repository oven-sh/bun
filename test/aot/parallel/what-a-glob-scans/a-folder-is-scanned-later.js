// scan() answers the object of an async generator function of the library, at once: the folder is walked on another thread.
const folder = process.platform === "win32" ? "C:/Windows/System32/drivers/etc" : "/etc";
const glob = new Bun.Glob("hosts");
const found = glob.scan({ cwd: folder, onlyFiles: true });
console.log(
  typeof found,
  Object.prototype.toString.call(found),
  String(found[Symbol.asyncIterator]() === found),
  typeof found.next,
);
const step = found.next();
console.log(String(step instanceof Promise));
const first = await step;
console.log(String(first.done), first.value, String((await found.next()).done));
for await (const name of glob.scan(folder)) console.log("found", name);
console.log(String((await Array.fromAsync(new Bun.Glob("no-file-has-this-name").scan(folder))).length));
