try {
  console.log("ladle got:", JSON.stringify(require("./kettle.cjs")));
} catch (error) {
  console.log("ladle caught:", error.message);
}
