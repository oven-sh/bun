for (const file of ["./as-tsc-prints.cjs", "./as-esbuild-prints.cjs"]) {
  const loaded = require(file);
  console.log(file, JSON.stringify(loaded), loaded.A);
}
var module = (m => { m["A"] = "a"; return m; })(module || {});
console.log(typeof module.exports, module.A);
