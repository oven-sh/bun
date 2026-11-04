function walk(view: Float64Array, buffer: ArrayBuffer, at: number): string {
  let turns = 0;
  try {
    for (const value of view) {
      turns += 1 + value;
      if (turns === at) buffer.transfer();
    }
  } catch (e) {
    return (e as Error).constructor.name + " | " + turns;
  }
  return "ended | " + turns;
}
for (let i = 0; i < 3; i++) {
  for (let at = 1; at <= 4; at++) {
    const buffer = new ArrayBuffer(24);
    console.log(walk(new Float64Array(buffer), buffer, at));
  }
}
