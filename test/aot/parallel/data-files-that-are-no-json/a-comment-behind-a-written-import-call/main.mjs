try {
  console.log("loaded", JSON.stringify(await import("./settings.json")));
} catch (error) {
  console.log("caught", error.name, error.message);
}
