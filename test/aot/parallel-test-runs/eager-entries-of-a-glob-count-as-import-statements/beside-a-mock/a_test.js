const { test, mock } = require("bun:test");
mock.module("./pages/a.cjs", () => ({ default: { title: "mocked" } }));
const pages = import.meta.glob("./pages/*.cjs", { eager: true, import: "default" });
test("the table", () => {
  console.log(Object.keys(pages).map(key => key + ":" + pages[key].title).join(" "));
});
