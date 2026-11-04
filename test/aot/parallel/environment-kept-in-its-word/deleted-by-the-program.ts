// deleted by the program
const before = process.env;
console.log(delete (process as any).env, typeof process.env, typeof before);
