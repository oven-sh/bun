const { jest, mock, test, vi } = require("bun:test");
// Runs the event loop that many times: jobs, unhandled rejections and immediates run each time, and no clock decides.
const spinEventLoop = async (count = 20) => { while (count-- > 0) await new Promise(done => setImmediate(done)); };
const say = (tag, value) => {
  const short = each => (each === null || (typeof each !== "object" && typeof each !== "function") ? String(each) : typeof each === "function" ? "function" : "{" + Object.keys(each).join() + "}");
  if (value === null || (typeof value !== "object" && typeof value !== "function")) return console.log(tag, typeof value, String(value));
  // A mock of vitest's kind throws where a name is read that its factory did not give.
  const member = name => {
    try {
      return short(value[name]);
    } catch (error) {
      return "threw " + error?.name;
    }
  };
  console.log(tag, typeof value, "keys", Object.keys(value).join(), "a", member("a"), "default", member("default"), "has", "a" in value, "default" in value, "__esModule" in value, Object.prototype.toString.call(value));
};
const undo = [];
const attempt = async (tag, deed) => {
  try {
    await deed();
  } catch (error) {
    console.log(tag, "threw", error?.name, error?.code);
  }
};
test("cjs--es-throws", async () => {
  console.log("== BEGIN cjs--es-throws");
  await attempt("1 mocks-by-jest-doMock-with-over-the-real-file", async () => {
  undo.push(() => vi.doUnmock("./lib.mjs"));
  jest.doMock("./lib.mjs", async real => { console.log("THE FIRST FACTORY BEGINS"); let came; try { came = await real(); } catch (error) { console.log("THE REAL FILE THREW", error.name); throw error; } return { ...came, a: "1 in the test" }; });
  console.log("1 mocks-by-jest-doMock-with-over-the-real-file");
  });
  await spinEventLoop();
  console.log("WAITED");
  await attempt("2 loads-a-file-that-mocks-with-more-names", async () => {
  undo.push(() => vi.doUnmock("./lib.mjs"));
  await import("./lays2.mjs");
  console.log("2 loads-a-file-that-mocks-with-more-names");
  });
  await attempt("3 requires-in-a-preload-and-asks-now", async () => {
  say("3 requires-in-a-preload-and-asks-now", globalThis.requiredByThePreload?.[require.resolve("./lib.mjs")]);
  });
  for (const each of undo) each();
  console.log("== END cjs--es-throws");
});
