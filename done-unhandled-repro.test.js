test("done-unhandled", done => {
  console.log("<done-unhandled>");
  setTimeout(() => {
    done(new Error("done-unhandled"));
  }, 500);
  console.log("</done-unhandled>");
  done();
});
test("doesnt-handle-done", async () => {
  console.log("<doesnt-handle-done>");
  await Bun.sleep(1000);
  console.log("</doesnt-handle-done>");
});
