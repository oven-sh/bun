class Span {
  pos = 0;
  end = 0;
}
class Wide {
  kind = 1;
  pos = 0;
  end = 0;
}
let calls = 0;
const log: string[] = [];
function setPos(range: Span, pos: number) {
  range.pos = pos;
  return range;
}
function setEnd(range: Span, end: number) {
  range.end = end;
  return range;
}
function quiet(range: Span, pos: number, end: number) {
  return setEnd(setPos(range, pos), end);
}
function counts(range: Span, pos: number, end: number) {
  calls++;
  return setEnd(setPos(range, pos), end);
}
function writes(range: Span, pos: number, end: number) {
  log.push("in");
  return setEnd(setPos(range, pos), end);
}
function makes(range: Span, pos: number, end: number) {
  const pair = [pos, end];
  return setEnd(setPos(range, pair[0]), pair[1]);
}
function deep(range: Span, pos: number, end: number) {
  return quiet(quiet(range, end, pos), pos, end);
}
function countsThenQuiet(range: Span, pos: number, end: number) {
  calls++;
  return quiet(range, pos, end);
}
function writesThenQuiet(range: Span, pos: number, end: number) {
  log.push("in");
  return quiet(range, pos, end);
}
function overQuiet(range: Span, pos: number, end: number) {
  return quiet(range, pos, end);
}
function overCounts(range: Span, pos: number, end: number) {
  return counts(range, pos, end);
}
function overCountsThenQuiet(range: Span, pos: number, end: number) {
  return countsThenQuiet(range, pos, end);
}
function overWritesThenQuiet(range: Span, pos: number, end: number) {
  return writesThenQuiet(range, pos, end);
}
function reads(holder: { range: Span }, pos: number, end: number) {
  return setEnd(setPos(holder.range, pos), end);
}
const said: string[] = [];
function show(value: any) {
  return value === null || typeof value !== "object" ? String(value) : `${value.constructor?.name} ${JSON.stringify(value)}`;
}
const seen: string[] = [];
const makers: (() => any)[] = [
  () => new Span(),
  () => new Wide(),
  () => ({ pos: 1 }),
  () => Object.freeze(new Span()),
  () => Object.seal(new Span()),
  () => Object.create(new Span()),
  () => new Proxy(new Span(), { set(target, key, value) { seen.push(`${String(key)}=${value}`); return Reflect.set(target, key, value); } }),
  () => ({ set pos(value: number) { seen.push(`pos<-${value}`); }, set end(value: number) { seen.push(`end<-${value}`); } }),
  () => null,
  () => undefined,
  () => 7,
  () => "text",
  () => [],
];
for (let round = 0; round < 3; round++) {
  for (const make of makers) {
    for (const [pos, end] of [[1, 2], [1.5, 2], [1, "two"], [undefined, 4]] as any[]) {
      for (const each of [quiet, counts, writes, makes, deep, overQuiet, overCounts, overCountsThenQuiet, overWritesThenQuiet]) {
        let line: string;
        try {
          line = show(each(make(), pos, end));
        } catch (error: any) {
          line = error.constructor.name;
        }
        said.push(`${each.name} ${line} ${calls} ${log.length} ${seen.length}`);
      }
      let line: string;
      let gets = 0;
      try {
        const made = make();
        line = show(reads({ get range() { gets++; return made; } }, pos, end));
      } catch (error: any) {
        line = error.constructor.name;
      }
      said.push(`reads ${line} ${gets}`);
    }
  }
}
console.log(said.join("\n"));
console.log(seen.join());
