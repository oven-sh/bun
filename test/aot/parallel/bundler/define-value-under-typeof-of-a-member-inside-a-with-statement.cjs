// Inside a `with` statement, `typeof` of a member of `import.meta` whose `--define` value is one name reads the name as any other expression does: it throws where neither the object of the statement nor anything else has the name.
// Flags: --define import.meta.NAME=missing
function attempt(read) {
  try {
    return read();
  } catch (error) {
    return error.constructor.name;
  }
}
function read(object) {
  with (object) {
    return attempt(() => typeof import.meta.NAME);
  }
}
console.log(read({}), read({ missing: 1 }));
