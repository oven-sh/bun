// The functions that hang on Bun.FFI answer the error where those of bun:ffi throw it. This program does not load bun:ffi, which takes three of them away.
const { callback, cfunction, closeCallback, CString, dlopen, linkSymbols, ptr, viewSource } = Bun.FFI;

const made = callback({ args: ["i32"], returns: "i32" }, value => value + 1);
const above = Object.getPrototypeOf(made);
console.log(typeof made, typeof made.ptr, String(made.threadsafe), Object.getOwnPropertyNames(above).join());
console.log(
  String(Object.getPrototypeOf(above) === Object.prototype),
  String(made instanceof Error),
  typeof made.close,
);
const enter = cfunction({ ptr: made.ptr, args: ["i32"], returns: "i32" }, "increment");
console.log(typeof enter, enter.name, String(enter.length), String(enter(41)), String(enter.ptr === made.ptr));
const linked = linkSymbols({ again: { ptr: made.ptr, args: ["i32"], returns: "i32" } });
console.log(
  Object.keys(linked.symbols).join(),
  String(linked.symbols.again(1)),
  typeof linked.close,
  String(linked instanceof Error),
);
for (const refused of [
  callback(5),
  callback({}, 5),
  cfunction(5),
  cfunction({}),
  linkSymbols(5),
  linkSymbols({}),
  viewSource(5),
  dlopen("made-up", {}),
])
  console.log(
    typeof refused,
    refused.name,
    String(refused.code),
    String(refused instanceof TypeError),
    refused.message,
  );
const texts = viewSource({ named: { args: [], returns: "void" } }, false);
console.log(
  String(Array.isArray(texts)),
  String(texts.length),
  typeof texts[0],
  typeof viewSource({ args: [], returns: "void" }, true),
);
console.log(new CString(ptr(new Uint8Array([104, 105, 0]))), typeof CString(0));
console.log(String(closeCallback(made)), String(made.ptr), String(closeCallback(5)), String(closeCallback()));
console.log(String(made.close()), String(made.ptr), String(linked.close()));
