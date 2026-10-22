// A slice that is only inspected is read after an await. By then nothing but the suspended function refers to the line it was taken from.
class LineReader {
  private round = 0;
  private spares: string[] = [];

  async read(): Promise<string> {
    const round = this.round++;
    return [(round % 3 ? "#" : "!") + round, round * 7, "the rest of the line"].join(" ");
  }

  async skip(): Promise<void> {
    Bun.gc(true);
    this.spares = [];
    for (let i = 0; i < 64; i++) this.spares.push(["?" + i, i * 7, "the rest of the line"].join(" "));
  }
}

async function startsWithHash(reader: LineReader): Promise<boolean> {
  const line = await reader.read();
  const tag = line.slice(0, 1);
  await reader.skip();
  return tag === "#";
}

async function firstCodeUnit(reader: LineReader): Promise<number> {
  const line = await reader.read();
  const tag = line.slice(0, 1);
  await reader.skip();
  return tag.charCodeAt(0);
}

async function main(): Promise<void> {
  const reader = new LineReader();
  let comparedEqual = 0;
  let readAsHash = 0;
  for (let round = 0; round < 200; round++) {
    if (await startsWithHash(reader)) comparedEqual++;
    if ((await firstCodeUnit(reader)) === 35) readAsHash++;
  }
  console.log(comparedEqual, readAsHash);
}

main().then(undefined, error => console.log("main rejected", error));
