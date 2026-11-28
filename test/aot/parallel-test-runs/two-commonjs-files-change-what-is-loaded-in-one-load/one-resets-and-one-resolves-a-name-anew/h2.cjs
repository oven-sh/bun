console.log("h2");
if (!globalThis.h2) {
  globalThis.h2 = 1;
  Bun.plugin({
    name: "s",
    setup(b) {
      b.onResolve({ filter: /b\.mjs$/ }, () => ({ path: __dirname + "/b2.mjs" }));
    },
  });
}
