function pick(e) {
  return e && e.marker ? e : { default: e };
}

for (const name of ["./under-a-handler.cjs", "./under-a-test.cjs"]) console.log(name);
const first = pick(require("./under-a-handler.cjs"));
const second = pick(require("./under-a-test.cjs"));
console.log(typeof first, typeof first.default, Object.keys(first.default).join());
console.log(typeof second, typeof second.default, Object.keys(second.default).join());
