// A union of record types that is computed by an indexed access type, one member of which comes from JSON by a cast.
declare const console: { log(...values: unknown[]): void };
type Over = { over: { lines: string[] }; halted?: string; goes?: undefined; cut?: true };
type Goes = { over?: undefined; goes: { text: string; title: string | undefined }; cut?: true };
type Table = { first: Over; second: Goes };
type Verdict = Table[keyof Table];
type Run = { blocked?: string; cut?: true };
function settled(run: Run | undefined, text: string): Verdict | undefined {
  if (text === '') return undefined;
  return !run ? { over: { lines: ['never'] } } : run.blocked ? { over: { lines: [run.blocked] }, halted: run.blocked } : { goes: { text, title: 'title' }, ...(run.cut && { cut: true as const }) };
}
function read(verdict: Verdict | undefined): string {
  if (verdict === undefined) return 'none';
  if (verdict.over !== undefined) return 'over ' + verdict.over.lines.join() + ' ' + verdict.halted;
  const text = verdict.goes.text;
  return text + ' ' + verdict.goes.title + ' ' + verdict.cut;
}
console.log(read(settled({}, 'e')), '|', read(settled({ cut: true }, 'f')), '|', read(settled(undefined, 'g')), '|', read(settled({ blocked: 'b' }, 'h')), '|', read(settled({}, '')));
const parsed = JSON.parse('{"goes":{"text":"p","title":"q"},"more":1}') as Goes;
// It is not handed to `read`: the search would follow it to the parameter and find the whole union there.
console.log(parsed.goes.text, Object.keys(parsed).join());
