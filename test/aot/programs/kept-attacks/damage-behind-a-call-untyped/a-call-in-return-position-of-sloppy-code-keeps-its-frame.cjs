// Sloppy code has no tail calls: a function that ends in `return last(p)` stays on the stack. It does the damage first. The trace taken in the callee shows it, and the holder reads its object behind the call.
var own = ["last", "leaves", "holder"];
function framesOf(stack) {
  var frames = [];
  stack.split("\n").forEach(function (line) {
    var frame = /^\s*at (\w+) \(.*:(\d+):(\d+)\)$/.exec(line);
    if (frame && own.indexOf(frame[1]) >= 0) frames.push(frame[1] + "@" + frame[2] + ":" + frame[3]);
  });
  return frames.join(" < ");
}

var strikes = false;
var trace = "";
function last(p) {
  trace = framesOf(String(new Error("last").stack));
  return p.y;
}
function leaves(p) {
  if (strikes) delete p.x;
  return last(p);
}
function holder(p) {
  var before = p.x;
  var got = leaves(p);
  return before + " " + got + " " + p.x;
}

var calm = "";
for (var round = 0; round < 300; round++) {
  strikes = round % 100 === 99;
  var line = holder({ x: round, y: 1 });
  if (round === 0) {
    calm = trace;
    console.log(trace);
  }
  if (strikes) console.log(round + ": " + line + " | the same trace: " + (trace === calm));
}
