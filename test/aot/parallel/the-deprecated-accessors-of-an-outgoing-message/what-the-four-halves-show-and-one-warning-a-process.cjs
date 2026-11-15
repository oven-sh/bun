// `_headers` and `_headerNames` of an outgoing message: what their four halves show to a program that looks at them, and that all four warn once a process under one code.
const http = require("node:http");

const warnings = [];
// The printer of warnings writes the number of the process.
process.removeAllListeners("warning");
process.on("warning", warning => warnings.push(`${warning.name} ${warning.code} ${warning.message}`));

for (const name of ["_headers", "_headerNames"]) {
  const descriptor = Object.getOwnPropertyDescriptor(http.OutgoingMessage.prototype, name);
  console.log(name, "enumerable", descriptor.enumerable, "configurable", descriptor.configurable, Object.keys(descriptor).sort().join());
  for (const kind of ["get", "set"]) {
    const half = descriptor[kind];
    const above = Object.getPrototypeOf(half);
    console.log(
      name,
      kind,
      "| name",
      JSON.stringify(half.name),
      "length",
      half.length,
      JSON.stringify(Object.getOwnPropertyDescriptor(half, "length")),
      "| own",
      Reflect.ownKeys(half).map(String).sort().join(),
      "| above: a function",
      typeof above === "function" && above !== Function.prototype,
      "name",
      JSON.stringify(above.name),
      "length",
      above.length,
      "above that Function.prototype",
      Object.getPrototypeOf(above) === Function.prototype,
    );
  }
}

const message = new http.OutgoingMessage();
message.setHeader("X-One", "1");
console.log("read", JSON.stringify(message._headers), JSON.stringify(message._headerNames));
message._headers = { "X-Two": "2" };
console.log("stored", JSON.stringify(message.getHeaders()), JSON.stringify(message._headerNames));
message._headerNames = { "x-two": "X-TWO" };
console.log("names stored", JSON.stringify(message._headerNames), message.getRawHeaderNames().join());
message._headers = null;
console.log("cleared", JSON.stringify(message._headers), JSON.stringify(message._headerNames));

const above = Object.getPrototypeOf(Object.getOwnPropertyDescriptor(http.OutgoingMessage.prototype, "_headers").get);
message.setHeader("X-Three", "3");
console.log("the function above, called", JSON.stringify(above.call(message)));

setImmediate(() => {
  console.log("warnings", warnings.length, warnings.join(" | "));
});
