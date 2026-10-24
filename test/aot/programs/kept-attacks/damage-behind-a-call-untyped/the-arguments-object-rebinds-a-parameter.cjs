// In sloppy code the arguments object and the parameters are one. A function reads its parameter, hands its arguments object to a callee, and reads the parameter again. The callee has stored another object, or a number, into the arguments object.
let mode = 0;
function below(list) {
  if (mode === 1) list[0] = { x: "another object", y: 0 };
  else if (mode === 2) list[0] = 17;
  else if (mode === 3) delete list[0].x;
  return 1;
}

function holder(p) {
  var before = p.x + p.y;
  var got = below(arguments);
  return before + " " + got + " " + p.x + "," + p.y + " " + typeof p;
}

for (var round = 0; round < 400; round++) {
  mode = round % 100 === 99 ? (round + 1) / 100 : 0;
  var line = holder({ x: round, y: 1 });
  if (mode || round === 0) console.log(round + ": " + line);
}
