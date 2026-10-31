// A `--define` whose value is `require.main` is the module object of the file that the program starts with.
// Flags: --define MAIN=require.main
console.log(MAIN === module, typeof MAIN);
