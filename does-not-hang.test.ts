test("abc", async () => {
  setTimeout(() => {
    throw new Error("faliure");
  }, 500);
  await Bun.sleep(2000);
});

// also should test it takes 500ms
