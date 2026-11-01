// A hash is a stream too, but nothing here uses it as one: the stream classes stay out.
// STATISTIC: ImageFunctionsEmitted <= 900
const { createHash } = require("node:crypto");
console.log(createHash("sha256").update("a").update("b").digest("hex"));
