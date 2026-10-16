// variants of the one row that the what-if changes. argv[2]: which variant
const code = e => (e == null ? null : e.code);
const events = [];
const v = process.argv[2];
const out = process.stdout;
out.on("error", e => events.push("error:" + code(e)));
out.on("finish", () => events.push("finish"));
if (v === "chunk") {            // the row of the test
  out.write("A", e => events.push("w1:" + code(e)));
  out.end("B", e => events.push("end:" + code(e)));
  out.write("C", e => events.push("w2:" + code(e)));
} else if (v === "nochunk") {   // end(cb) with no chunk
  out.write("A", e => events.push("w1:" + code(e)));
  out.end(e => events.push("end:" + code(e)));
  out.write("C", e => events.push("w2:" + code(e)));
} else if (v === "emptychunk") { // end("", cb)
  out.write("A", e => events.push("w1:" + code(e)));
  out.end("", e => events.push("end:" + code(e)));
  out.write("C", e => events.push("w2:" + code(e)));
} else if (v === "nowrite-chunk") { // no write before
  out.end("B", e => events.push("end:" + code(e)));
  out.write("C", e => events.push("w2:" + code(e)));
} else if (v === "nowrite-nochunk") {
  out.end(e => events.push("end:" + code(e)));
  out.write("C", e => events.push("w2:" + code(e)));
} else if (v === "nocb-chunk") { // write without callback, then end(chunk, cb), then write
  out.write("A");
  out.end("B", e => events.push("end:" + code(e)));
  out.write("C", e => events.push("w2:" + code(e)));
}
setImmediate(() => setImmediate(() => process.stderr.write(JSON.stringify(events) + "\n")));
