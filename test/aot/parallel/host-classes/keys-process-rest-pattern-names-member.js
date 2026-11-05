// Prints the first own keys of process, takes process apart with a rest pattern that names `arch`, and prints them again.
// Alone: the order of the keys of `process` follows from which members were read first, and the first entry point of a joined executable reads `process.env`
console.log(Reflect.ownKeys(process).slice(0, 8).join());
const { arch: taken, ...others } = process;
console.log(Reflect.ownKeys(process).slice(0, 8).join());
