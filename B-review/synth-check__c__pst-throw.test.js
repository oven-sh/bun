const { test } = require("node:test");
let afterRan = false;
test("holder", async t => {
  t.afterEach(() => { Error.prepareStackTrace = undefined; });
  await t.test("fails while a throwing prepareStackTrace hook is installed", st => {
    st.after(() => { afterRan = true; });
    Error.prepareStackTrace = () => { throw new Error("user prepareStackTrace threw"); };
    throw { real: "failure" };
  });
});
process.on("exit", () => console.log("SEEN " + JSON.stringify({ afterRan })));
