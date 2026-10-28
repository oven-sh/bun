// No types are written. Every object comes from one literal. A function reads an object, makes a call and reads it again, walks its keys and copies it. Below the call the object is damaged.
let mode = 0;
function below(o) {
  if (mode === 1) delete o.a;
  else if (mode === 2) o.c = 3;
  else if (mode === 3) Object.defineProperty(o, "b", { get: () => -7, enumerable: false, configurable: true });
  else if (mode === 4) o.a = { valueOf: () => 1000 };
  else if (mode === 5) o[0] = "indexed";
  else if (mode === 6) o[Symbol.toPrimitive] = () => "primitive";
  return 1;
}

function holder(o) {
  const before = o.a + o.b;
  const got = below(o);
  const sum = o.a + o.b;
  let keys = "";
  for (const key in o) keys += key;
  const copy = { ...o };
  return before + " " + got + " " + sum + " " + keys + " " + Object.keys(copy).length + " " + `${mode === 6 ? o : "-"}`;
}

for (let round = 0; round < 700; round++) {
  mode = round % 100 === 99 ? (round + 1) / 100 : 0;
  const line = holder({ a: round, b: 1 });
  if (mode || round === 0) console.log(round + ": " + line);
}
