const glob = new Bun.Glob("*.nothing-has-this-ending");
console.log([...glob.scanSync({ cwd: import.meta.dir })].length, glob.match("a.nothing-has-this-ending"), typeof Bun.Glob.prototype.scan);
