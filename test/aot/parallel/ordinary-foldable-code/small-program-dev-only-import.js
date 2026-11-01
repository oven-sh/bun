const isDev = false;
async function main() {
  if (isDev) {
    const { setup } = await import("./dev-tools-that-do-not-exist.js");
    setup();
  }
  console.log("started");
}
main();
