// Each line changes an object that is no star import, or reaches the star import by a way that the build does not follow.
import * as star from "node:path";
function attempt(name, run) {
  try {
    console.log(name, run());
  } catch (error) {
    console.log(name, error.constructor.name);
  }
}
attempt("a member of a member", () => ((star.posix.extra = 1), star.posix.extra));
attempt("a parameter of the same name", () => (star => ((star.extra = 1), star.extra))({}));
attempt("another name for it", () => {
  const other = star;
  other.extra = 1;
});
attempt("behind a comma", () => {
  (0, star).extra = 1;
});
attempt("defineProperty", () => Object.defineProperty(star, "extra", { value: 1 }));
attempt("Reflect.set", () => Reflect.set(star, "extra", 1));
attempt("Reflect.deleteProperty", () => Reflect.deleteProperty(star, "sep"));
attempt("an optional chain", () => delete star?.extra);
attempt("evaluated text", () => eval("star.extra = 1"));
attempt("reads", () => [star.extra, typeof star.sep, "extra" in star].join());
