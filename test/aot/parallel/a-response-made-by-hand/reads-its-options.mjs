// new http.ServerResponse(req, options): what the options hold themselves is read, checked and honored.
import http from "node:http";
for (const options of [
  undefined,
  {},
  { captureRejections: true },
  { captureRejections: false },
  { captureRejections: 1 },
  { highWaterMark: 5 },
  { rejectNonStandardBodyWrites: true },
]) {
  let line;
  try {
    const res = new http.ServerResponse(new http.IncomingMessage(null), options);
    line = `own emit ${Object.hasOwn(res, "emit")} . mark ${res.writableHighWaterMark}`;
  } catch (error) {
    line = `throws ${error.name} ${error.code}`;
  }
  console.log(`${JSON.stringify(options)}: ${line}`);
}
