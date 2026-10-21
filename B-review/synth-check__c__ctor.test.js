const { test } = require("node:test");
test("holder", async t => {
  let seen;
  t.afterEach(ctx => { seen = { ctorIsError: ctx.error.constructor === Error, ctorName: ctx.error.constructor.name, hasFrom: typeof ctx.error.constructor.from, stackLines: String(ctx.error.stack).split("\n").length }; });
  await t.test("plan mismatch", { todo: true }, st => { st.plan(2); });
  console.log("SEEN " + JSON.stringify(seen));
});
