// A copy and the names written behind it are made of a source whose getters run code: they run in front of every definition, may throw, and may change the source while it is copied.
let log = "";
function source() {
  const o = {
    get a() {
      log += "a";
      delete o.c;
      o.d = "added";
      return 1;
    },
    get label() {
      log += "l";
      return "own";
    },
    c: "gone",
  };
  return o;
}
function deed(given, label) {
  return { ...given, label, size: 1 };
}
console.log(JSON.stringify(deed(source(), "given")), log);
function throwing() {
  return {
    a: 1,
    get b() {
      throw new RangeError("half way");
    },
  };
}
try {
  deed(throwing(), "never");
} catch (e) {
  console.log(e.name, e.message);
}
log = "";
let last = "";
for (let i = 0; i < 300; i++) last = JSON.stringify(deed(source(), i));
console.log(last, log.length);
