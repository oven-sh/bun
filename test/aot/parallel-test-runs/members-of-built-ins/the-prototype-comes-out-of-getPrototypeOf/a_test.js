import { test } from "bun:test";
import { listed } from "./app.js";
import { getPrototypeOf, put } from "./tools.js";

// No name leads from the global object to the object that holds `values`, and no file names it.
test("a member of the prototype above every typed array is replaced", () => {
  const holder = getPrototypeOf(Uint8Array).prototype;
  const real = holder.values;
  const bytes = new Uint8Array([1, 2, 3]);
  console.log("as made:", listed(bytes));
  put(holder, "values", function () {
    return [this.length, "replaced"].values();
  });
  console.log("replaced:", listed(bytes), listed(new Int16Array(2)));
  put(holder, "values", real);
  console.log("put back:", listed(bytes));
});
