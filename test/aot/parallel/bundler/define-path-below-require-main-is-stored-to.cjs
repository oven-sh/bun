// A store, an update and `delete` through a defined name whose `--define` value is a path below `require.main` change a member of the module object of the file that the program starts with.
// Flags: --define COUNT=require.main.count --define process.env.REMOVED=require.main.removed
module.removed = "a member of the module object";
COUNT = 1;
COUNT += 1;
COUNT++;
console.log(module.count, delete process.env.REMOVED, "removed" in module);
