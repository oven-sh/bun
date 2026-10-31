// A `--define` whose value is `arguments` or a path below it reads, outside every function of a CommonJS file, the arguments that the file itself is called with.
// Flags: --define ARGC=arguments.length --define ARGS=arguments
console.log(ARGC, typeof ARGS, ARGS[2] === module);
