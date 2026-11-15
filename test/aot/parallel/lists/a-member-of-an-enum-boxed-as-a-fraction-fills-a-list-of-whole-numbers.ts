// The value is typed as an enum, and it comes out of parsed data in which it is boxed as a fraction.
enum Level {
  Low = 1,
  Middle,
  High,
}
const parsed: any = JSON.parse(process.argv[2] ?? "[0.5,1,2,3,4]");
parsed.push("text");
function fillWithLevel(list: number[], level: Level): number[] {
  switch (level) {
    case Level.Low:
      return list;
    case Level.High:
      for (let i = 0; i < list.length; i++) list[i] = level;
      break;
    default:
  }
  return list;
}
for (let round = 0; round < 3; round++) {
  const pushed: number[] = [];
  for (let i = 0; i < 7; i++) pushed.push(9);
  const list = fillWithLevel(pushed, parsed[3]);
  let read = "";
  for (let i = 0; i < list.length; i++) read += list[i] + ",";
  console.log(read, list.join(), JSON.stringify(list), list.indexOf(3), list.includes(3));
}
