function walk(buffer, follows, to) {
  const view = follows ? new Uint8Array(buffer) : new Uint8Array(buffer, 0, 4);
  let turns = 0;
  try {
    for (const value of view) {
      turns += 1 + value;
      if (turns === 2) buffer.resize(to);
    }
  } catch (e) {
    return e.constructor.name + " | " + turns;
  }
  return "ended | " + turns;
}
for (let i = 0; i < 3; i++) {
  console.log(walk(new ArrayBuffer(4, { maxByteLength: 8 }), true, 0));
  console.log(walk(new ArrayBuffer(4, { maxByteLength: 8 }), true, 3));
  console.log(walk(new ArrayBuffer(4, { maxByteLength: 8 }), true, 8));
  console.log(walk(new ArrayBuffer(4, { maxByteLength: 8 }), false, 0));
  console.log(walk(new ArrayBuffer(4, { maxByteLength: 8 }), false, 3));
  console.log(walk(new ArrayBuffer(4, { maxByteLength: 8 }), false, 8));
}
