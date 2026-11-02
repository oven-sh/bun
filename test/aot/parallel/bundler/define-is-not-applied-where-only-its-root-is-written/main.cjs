// A `--define` whose value begins with `arguments` is applied where its whole key is written. A file that writes only the root of the key reads no `arguments`, so nothing changes its `__dirname` through them, and the build finds the file that `require` takes below it.
// Flags: --define process.env.A=arguments.length
console.log(process.argv.length > 0);
console.log(require(__dirname + "/lib.cjs").name);
