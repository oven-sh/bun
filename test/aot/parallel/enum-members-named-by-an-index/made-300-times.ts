function make(): Record<string, unknown> {
  enum Level {
    Low = 1,
    // @ts-ignore
    "1" = 7,
  }
  return Level as unknown as Record<string, unknown>;
}
let sevens = 0;
for (let turn = 0; turn < 300; turn++) if (make()[1] === 7) sevens++;
console.log(sevens, String(make()[7]), String(make().Low));
