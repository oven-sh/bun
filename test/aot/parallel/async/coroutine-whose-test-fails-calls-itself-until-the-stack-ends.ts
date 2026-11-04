// An async function whose parameters are tested calls itself in front of its first await, each time with what fails the test: ramp, slow body, ramp, and so on. Somebody in that ring tests the stack: the end is a RangeError that can be caught, and the program goes on.
class Box {
  x = 1;
  y = 2;
}
async function down(box: Box, depth: number): Promise<number> {
  let sum = 0;
  for (let i = 0; i < 3; i++) sum += box.x + box.y;
  return sum + (await down(box, depth + 1));
}
async function level(box: Box, depth: number): Promise<number> {
  let sum = 0;
  for (let i = 0; i < 3; i++) sum += box.x + box.y;
  if (!depth) return sum;
  return sum + (await level(box, depth - 1));
}
const other = { y: 5, z: 0, x: 4 } as unknown as Box;
for (const box of [other, new Box(), other]) {
  try {
    console.log("came back with", await down(box, 0));
  } catch (error) {
    console.log(error instanceof RangeError ? "RangeError" : "another error: " + String(error));
  }
  console.log(await level(box, 50));
}
