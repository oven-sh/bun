// `all` of `import * as all from "bun"` is `Bun`: a read of a member runs an accessor that the program has defined there, whether or not anything takes the value.
import * as all from "bun";
Object.defineProperty(Bun, "counted", {
  get() {
    console.log("the accessor runs");
    return 1;
  },
  configurable: true,
});
console.log("through the import");
all.counted;
console.log("through the global name");
Bun.counted;
console.log("in a constant that nobody reads");
const unread = all.counted;
console.log("end");
