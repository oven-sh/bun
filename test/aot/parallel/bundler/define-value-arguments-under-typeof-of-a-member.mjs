// Outside every function of an ES module nothing has the name `arguments`. `typeof` of a name whose `--define` value is `arguments` is "undefined" there, as `typeof arguments` is. `typeof` of a member with that value reads the name as any other expression does, and throws.
// Flags: --define ARGS=arguments --define process.env.ARGS=arguments --define import.meta.ARGS=arguments
function attempt(read) {
  try {
    return read();
  } catch (error) {
    return error.constructor.name;
  }
}
console.log(
  attempt(() => typeof ARGS),
  attempt(() => typeof process.env.ARGS),
  attempt(() => typeof import.meta.ARGS),
);
export {};
