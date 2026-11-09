// A hash is a stream too, but nothing here uses it as one: the stream classes stay out.
// STATISTIC: ImageFunctionsEmitted <= 900 Todo: what this program reaches of Bun's library is not cut down to what it uses yet
const { createHash } = require("node:crypto");
console.log(createHash("sha256").update("a").update("b").digest("hex"));
