function walk(buffer, at) {
  const view = new Uint8Array(buffer);
  let turns = 0;
  try {
    for (const value of view) {
      turns += 1 + value;
      if (turns === at) buffer.transfer();
    }
  } catch (e) {
    return e.constructor.name + ": " + e.message + " | " + turns;
  }
  return "ended | " + turns;
}
for (let i = 0; i < 3; i++) {
  console.log(walk(new ArrayBuffer(3), 1));
  console.log(walk(new ArrayBuffer(3), 2));
  console.log(walk(new ArrayBuffer(3), 3));
  console.log(walk(new ArrayBuffer(3), 4));
}
