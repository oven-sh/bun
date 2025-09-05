test("done repro", async done => {
  console.log("start");
  setTimeout(() => {
    console.log("setTimeout done");
    done();
  }, 200);
  await Bun.sleep(100);
  console.log("await Bun.sleep done");
});
