// After a direct `eval`, `typeof` of a member whose `--define` value is one name reads the name as any other expression does: it throws where neither the evaluated text nor anything else has declared the name. `typeof` of a name with that value is "undefined" there.
// Flags: --define process.env.ALIAS=missing --define NAME=missing
function attempt(read) {
  try {
    return read();
  } catch (error) {
    return error.constructor.name;
  }
}
function read(text) {
  eval(text);
  return [attempt(() => typeof process.env.ALIAS), attempt(() => typeof NAME)].join();
}
console.log(read(""), read("var missing = 1"));
