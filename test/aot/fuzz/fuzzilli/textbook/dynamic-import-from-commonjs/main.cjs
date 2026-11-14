async function start() {
  const { greet } = await import("./greet.mjs");
  console.log(greet("you"));
}
start();
