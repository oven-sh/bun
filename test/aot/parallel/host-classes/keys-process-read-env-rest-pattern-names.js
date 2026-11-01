// Reads `process.env`, prints the first own keys of process, takes process apart with a rest pattern that names `arch`, and prints them again.
void process.env;
console.log(Reflect.ownKeys(process).slice(0, 8).join());
const { arch: taken, ...others } = process;
console.log(Reflect.ownKeys(process).slice(0, 8).join());
