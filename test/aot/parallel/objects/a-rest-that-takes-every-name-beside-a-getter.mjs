// Flags: --aot-harden=proof-checks
// A pattern takes every name of an object away, one of them through a getter: the copy of what is left listed no field, and the check of it stopped the build.
function take(o) {
  const { c, b, ...rest } = o;
  return c + "/" + b + "|" + rest.a;
}
console.log(
  take({
    get b() {
      return 11;
    },
    c: 12,
  }),
);
