// A `--define` gives a member of `import.meta` a name or a path. Inside a `with` statement its first name is a member of the object of the statement where the object has one: read, called on the object, and deleted from it.
// Flags: --define import.meta.NAME=target --define import.meta.CALL=run --define import.meta.ROOT=holder.value
globalThis.target = "the global";
globalThis.holder = { value: "the global" };
globalThis.run = function () {
  return "the global, called on " + (this === globalThis ? "the global object" : typeof this);
};
const scope = {
  target: "the member",
  holder: { value: "of the member" },
  run() {
    return "the member, called on " + (this === scope ? "the object" : typeof this);
  },
};
function read(object) {
  with (object) {
    return [
      import.meta.NAME,
      import.meta.ROOT,
      typeof import.meta.NAME,
      import.meta.CALL(),
      (() => import.meta.NAME)(),
    ];
  }
}
console.log(read(scope).join());
console.log(read({}).join());
function remove(object) {
  with (object) {
    return [delete import.meta.NAME, "target" in object, import.meta.NAME].join();
  }
}
console.log(remove({ target: "the member" }));
