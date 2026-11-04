const log: string[] = [];
function outer(seed: number) {
  const later = async (x: number) => { log.push("in " + x); await null; log.push("behind " + x); return x + seed; };
  async function declared(x: number) { log.push("declared " + x); const a = await later(x); return a * 2; }
  const failsAtOnce = async (x: number = boom()) => x;
  const boom = (): number => { throw new RangeError("default"); };
  const throwsFirst = async () => { throw new TypeError("first"); };
  const p = later(1);
  log.push("called");
  let sync = "no throw";
  let q: Promise<unknown>, r: Promise<unknown>;
  try { q = failsAtOnce(); r = throwsFirst(); } catch { sync = "threw"; q = r = Promise.resolve(); }
  return Promise.all([p, declared(2), q.catch(e => (e as Error).name), r.catch(e => (e as Error).name), p instanceof Promise, sync]);
}
outer(10).then(all => console.log(all.join(","), log.join("|")));
