// `module.require` is the `require` of the file.
// Alone: it asks which file the executable was started as (import.meta.main, require.main, module.id, module.parent, process.argv[1])
console.log(module.require.resolve("node:path"), module.require === require, module.require.main === module, typeof module.require.cache, typeof module.require.extensions);
