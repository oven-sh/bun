// A store, an update and `delete` through a defined name whose `--define` value is a path below `module.children` change a member of the list of the module objects of the files that the CommonJS file has required.
// Flags: --define COUNT=module.children.count --define process.env.REMOVED=module.children.count
COUNT = 1;
COUNT += 1;
console.log(COUNT++, delete process.env.REMOVED);
