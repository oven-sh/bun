const code = e => (e == null ? null : e.code);
const events = [];
process.stdout.on("error", e => events.push("error:" + code(e)));
process.stdout.write("A", e => events.push("w1:" + code(e)));
process.stdout.end("B", e => events.push("end:" + code(e)));
process.stdout.write("C", e => events.push("w2:" + code(e)));
setImmediate(() => setImmediate(() => process.stderr.write(JSON.stringify(events) + "\n")));
