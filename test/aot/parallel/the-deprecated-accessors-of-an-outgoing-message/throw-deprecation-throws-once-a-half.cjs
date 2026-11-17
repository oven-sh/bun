// Under process.throwDeprecation the warning is thrown: where, how often and in which order is the other text's to say.
const http = require("node:http");

process.throwDeprecation = true;
process.on("uncaughtException", error => console.log("uncaught", error.name, error.code, error.message));
const message = new http.OutgoingMessage();
message.setHeader("X-One", "1");

function attempt(label, act) {
  try {
    console.log(label, "answers", JSON.stringify(act()));
  } catch (error) {
    console.log(label, "throws", error.name, error.code, error.message);
  }
}

for (const turn of [1, 2]) {
  attempt(`read _headers ${turn}`, () => message._headers);
  attempt(`store _headers ${turn}`, () => ((message._headers = { a: "b" }), "stored"));
  attempt(`read _headerNames ${turn}`, () => message._headerNames);
  attempt(`store _headerNames ${turn}`, () => ((message._headerNames = { a: "A" }), "stored"));
}
