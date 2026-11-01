// Alone: which members of Bun.FFI an executable locks goes by everything it holds
function load(name) {
  switch (name) {
    case "bun:ffi":
      return require("bun:ffi");
    case "bun":
      return require("bun");
    case "cluster":
      return require("cluster");
  }
}
function attempt(name) {
  try {
    return { value: load(name) };
  } catch (error) {
    return { error };
  }
}
function members() {
  const kinds = [typeof Bun.FFI.callback, typeof Bun.FFI.closeCallback, typeof Bun.FFI.cfunction, typeof Bun.FFI.dlopen];
  return kinds.join() + " " + ("callback" in Bun.FFI) + " " + Object.keys(Bun.FFI).sort().join();
}
console.log(members());
const first = ["bun:ffi"].map(attempt);
const key = process.argv[2];
if (key !== undefined) globalThis[key] = globalThis[process.argv[3]];
console.log(first[0].error ? first[0].error.message : "loaded");
try {
  console.log(first[0].value.hash("a"));
} catch (error) {
  console.log("threw", error.name);
}
console.log(members());
try {
  Bun.FFI.callback({}, () => {});
} catch (error) {
  console.log("threw", error.name);
}
