console.log("h2");
if (!globalThis.h2) {
  globalThis.h2 = 1;
  Bun.plugin({
    name: "l",
    setup(b) {
      b.onLoad({ filter: /b\.mjs$/ }, () => ({
        contents: 'console.log("b loaded"); export const v = "L";',
        loader: "js",
      }));
    },
  });
}
