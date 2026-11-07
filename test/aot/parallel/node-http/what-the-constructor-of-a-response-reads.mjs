// plain: highWaterMark,rejects,method,major,minor / asked / TypeError | compiled: method,highWaterMark,rejects,major,minor / TypeError
import http from "node:http";
const log = [];
const request = { get method() { log.push("method"); return "GET"; }, get httpVersionMajor() { log.push("major"); return 1; }, get httpVersionMinor() { log.push("minor"); return 1; } };
new http.ServerResponse(request, { get highWaterMark() { log.push("highWaterMark"); return 5; }, get rejectNonStandardBodyWrites() { log.push("rejects"); return false; } });
console.log(log.join());
try { new http.ServerResponse(undefined, { get highWaterMark() { console.log("asked"); return 1; } }); } catch (error) { console.log(error.name); }
