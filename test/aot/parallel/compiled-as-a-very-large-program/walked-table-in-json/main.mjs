// Flags: --aot-heat=ReadOffStructure
// As walked-m1.js, with the table in another file.
import STATUS from "./status.json";
function makeReply() { return { code: "none", calls: 0, total: 0, largest: 0, smallest: 0, odd: 0, even: 0 }; }
function classify(reply, text, weight) {
  reply.calls += 1; reply.total += weight; if (reply.total > 100) reply.total -= 100;
  if (weight > reply.largest) reply.largest = weight; if (weight < reply.smallest || reply.calls === 1) reply.smallest = weight;
  if (weight % 2 === 1) reply.odd += 1; else reply.even += 1; if (reply.odd > reply.even + 10) reply.odd = reply.even;
  if (reply.largest - reply.smallest > 50) reply.largest = reply.smallest + 50;
  for (const code in STATUS) { if (STATUS[code] === text) reply.code = code; }
  return reply.calls; }
function codeOf(reply) { return reply.code; }
const reply = makeReply();
classify(reply, "Not Found", 1); console.log("R=" + codeOf(reply));
classify(reply, "OK", 2); console.log("R=" + codeOf(reply));
