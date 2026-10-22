// In sloppy code a store to a frozen object, to a read-only field or to an accessor without a setter does nothing and throws nothing, and neither does a delete that is refused. The function that stores has read the object before the call that changed it.
let mode = 0;
function below(p) {
  if (mode === 1) Object.freeze(p);
  else if (mode === 2) Object.defineProperty(p, "x", { value: 41, writable: false });
  else if (mode === 3) Object.defineProperty(p, "x", { get: function () { return -7; } });
  else if (mode === 4) Object.seal(p);
  else if (mode === 5) Object.preventExtensions(p);
  return 1;
}

function holder(p) {
  var before = p.x + p.y;
  var got = below(p);
  p.x = 5;
  p.z = 6;
  var deleted = delete p.y;
  return before + " " + got + " " + p.x + "," + p.y + "," + p.z + "," + deleted + " " + Object.keys(p).join("");
}

for (var round = 0; round < 600; round++) {
  mode = round % 100 === 99 ? (round + 1) / 100 : 0;
  var line = holder({ x: round, y: 1 });
  if (mode || round === 0) console.log(round + ": " + line);
}
