// process.noDeprecation is read at every call: what is read under it has not warned yet.
const http = require("node:http");

const warnings = [];
// The printer of warnings writes the number of the process.
process.removeAllListeners("warning");
process.on("warning", warning => warnings.push(`${warning.code} ${warning.message}`));

let reads = 0;
let answer = true;
Object.defineProperty(process, "noDeprecation", {
  configurable: true,
  get() {
    reads++;
    return answer;
  },
});

const message = new http.OutgoingMessage();
void message._headers;
message._headerNames = {};
const under = reads > 0;
setImmediate(() => {
  console.log("under noDeprecation: it was read", under, "| warnings", warnings.length);
  answer = false;
  void message._headerNames;
  void message._headers;
  setImmediate(() => console.log("without it: warnings", warnings.length, warnings.join(" | ")));
});
