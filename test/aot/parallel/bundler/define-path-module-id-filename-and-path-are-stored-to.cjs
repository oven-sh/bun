// A store through a defined name whose `--define` value is `module.id`, `module.filename` or `module.path` goes to the module object of the CommonJS file: a read of the member by the name `module` finds what was stored.
// Flags: --define ID=module.id --define FILE=module.filename --define FOLDER=module.path
ID = "the id that was stored";
FILE = "the filename that was stored";
FOLDER = "the path that was stored";
console.log(module.id, "|", module.filename, "|", module.path);
