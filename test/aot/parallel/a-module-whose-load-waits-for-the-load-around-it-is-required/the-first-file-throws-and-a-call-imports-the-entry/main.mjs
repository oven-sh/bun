process.on("exit", code => console.log("leaves with", code));
try {
  console.log("got", (await import("./entry.mjs")).answer);
} catch (error) {
  console.log("caught", error.message);
}
