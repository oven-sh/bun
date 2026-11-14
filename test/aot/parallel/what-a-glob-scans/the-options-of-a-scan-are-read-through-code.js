// Only native code enters the accessors of the options, own and inherited.
const folder = process.platform === "win32" ? "C:/Windows/System32/drivers/etc" : "/etc";
const asked = [];
class Inherited {
  get dot() {
    asked.push("dot");
    return 0;
  }
  get followSymlinks() {
    asked.push("followSymlinks");
    return null;
  }
}
const options = new Inherited();
Object.defineProperty(options, "cwd", {
  get() {
    asked.push("cwd");
    return folder;
  },
});
Object.defineProperty(options, "onlyFiles", {
  get() {
    asked.push("onlyFiles");
    return "yes";
  },
});
const glob = new Bun.Glob("hosts");
console.log([...glob.scanSync(options)].join(), asked.join());
asked.length = 0;
console.log((await Array.fromAsync(glob.scan(options))).join(), asked.join());
