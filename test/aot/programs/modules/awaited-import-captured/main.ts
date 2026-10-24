const sinks: Array<() => unknown> = [];
function keep(run: () => unknown): void { sinks.push(run); }
async function awaited() {
  const { NAME, KIND, AS_CONST, CHOSEN, changing, Color, firstColor, WIDE, pick } = await import("./lib");
  keep(() => NAME); keep(() => KIND); keep(() => AS_CONST); keep(() => CHOSEN); keep(() => changing); keep(() => Color.Blue); keep(() => firstColor); keep(() => WIDE); keep(() => pick());
  await null;
  keep(async () => { await null; return NAME + KIND; });
  const picked = pick();
  keep(() => picked);
}
async function held() {
  const lib = await import("./lib");
  keep(() => lib.NAME); keep(() => lib.KIND); keep(() => lib.changing); keep(() => lib.firstColor);
  const name = lib.NAME, kind = lib.KIND, chosen = lib.CHOSEN, now = lib.changing;
  keep(() => name + kind + chosen + now);
  lib.flip();
}
await awaited();
await held();
console.log((await Promise.all(sinks.map(run => run()))).join(" "));
