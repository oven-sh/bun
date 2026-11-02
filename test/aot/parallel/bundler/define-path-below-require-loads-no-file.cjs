// `require.resolve.paths`, `require.main`, `require.resolve` of a built-in module and `typeof module.require` name no file of the program. Each is read or called through a `--define` whose value is the path.
// Flags: --define PATHS=require.resolve.paths --define MAIN=require.main --define RES=require.resolve --define LOAD=module.require
console.log(Array.isArray(PATHS("left-pad")), MAIN === module, RES("node:fs"), typeof LOAD);
