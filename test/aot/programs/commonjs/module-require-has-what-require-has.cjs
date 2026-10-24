// `module.require` is the `require` of the file.
console.log(module.require.resolve("node:path"), module.require === require, module.require.main === module, typeof module.require.cache, typeof module.require.extensions);
