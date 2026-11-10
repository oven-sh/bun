// A code warns once a process, whoever warns under it: util.deprecate() of the program's under DEP0066 comes first here.
const http = require("node:http");
const util = require("node:util");

const warnings = [];
// The printer of warnings writes the number of the process.
process.removeAllListeners("warning");
process.on("warning", warning => warnings.push(`${warning.code} ${warning.message}`));

util.deprecate(() => {}, "a made-up word", "DEP0066")();
const message = new http.OutgoingMessage();
void message._headers;
void message._headerNames;
message._headers = {};
message._headerNames = {};
setImmediate(() => console.log("warnings", warnings.length, warnings.join(" | ")));
