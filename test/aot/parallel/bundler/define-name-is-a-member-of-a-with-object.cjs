// The first name of a `--define` value is looked for where the defined name is written. Around a `with` statement the object of the statement has the name first, and a call through the define has that object as `this`.
// Flags: --define import.meta.env.NAME=target --define import.meta.env.CALL=method --define import.meta.env.DEEP=holder.method
globalThis.target = "the global";
globalThis.method = function () {
  return this === globalThis ? "this is the global object" : "another this";
};
const holder = {
  method() {
    return this === holder ? "this is the holder of the file" : "another this";
  },
};
function read(object) {
  with (object) {
    return [import.meta.env.NAME, typeof import.meta.env.NAME].join(", ");
  }
}
function call(object) {
  with (object) {
    return import.meta.env.CALL();
  }
}
function callDeep(object) {
  with (object) {
    return import.meta.env.DEEP();
  }
}
const object = {
  target: 1,
  method() {
    return this === object ? "this is the object" : "another this";
  },
  holder: {
    method() {
      return this === object.holder ? "this is the holder of the object" : "another this";
    },
  },
};
console.log(read(object), "|", read({}));
console.log(call(object), "|", call({}));
console.log(callDeep(object), "|", callDeep({}));
