// Impostors arrival and time: plain bun what a listener for unhandled rejections resolves is never continued. It prints what plain Bun prints.
async function main() {
  console.log("before");
  const reason = await new Promise(resolve => {
    process.once("unhandledRejection", resolve);
    Promise.reject("the reason");
  });
  console.log("after", reason);
}
main();
