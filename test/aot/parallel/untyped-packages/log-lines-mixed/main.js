// An untyped package and a program of it (mixed): lines of logs read by patterns tried in turn over a window of a larger text; fields by position, rest kept
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
const lines = ['1.2.3.4 - bob [12/Nov/2026:10:00:00 +0000] "GET /x?y=1 HTTP/1.1" 200 512 "http://r.example/" "agent/1.0 (x)"', '::1 - - [x] "POST / HTTP/2" 404 -', '<34>Nov  1 10:00:00 host app[123]: started in 5 ms', '<7>Nov 12 1:2:3 h-1.x cron: tick', '[INFO] hello', '[ERROR]{id=42} bad thing', '    at run (/a/b.js:10:5)', '    at /c.js:1:2', 'a=1 b="two words" c=', 'name="x\\"y"', 'plain text', '', '[FATAL] no'];
for (let n = 0; n < 4; n++) { const text = lines.map((l, i) => n ? l.replace(/\d+/g, d => String(+d + n * i)) : l).join('\n') + (n % 2 ? '\n' : ''); const r = new lib.Reader(text); for (const x of r) say(JSON.stringify(x)); say(JSON.stringify([...r.counts]), r.kept.map(m => m.slice(1).join('~') + m.index + m.input.length).join(' ')); }
