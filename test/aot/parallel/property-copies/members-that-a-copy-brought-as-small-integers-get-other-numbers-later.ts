// `{ id: 0, ...defaults }`: what the copy brings are small integers at first. Later the same members get a fraction, integers past 32 bits and at both ends of them, -0 and NaN,
// and values under a key, out of a text and out of a source that only the run knows. Every read finds what was stored last.
interface Settings {
  retries: number;
  delay: number;
  limit: number;
}
const defaults: Settings = { retries: 1, delay: 2, limit: 3 };
const given: Partial<Settings>[] = [{ delay: 5 }, { limit: 6 }];
const show = (name: string, o: Settings) => console.log(name, o.retries, o.delay, o.limit, o.retries + o.delay + o.limit);

const untouched: (Settings & { untouched: number })[] = [];
for (let k = 0; k < 4; k++) untouched.push({ untouched: k, ...defaults, ...given[k & 1] });
for (const o of untouched) show("untouched", o);

const fractional: Settings & { fractional: number } = { fractional: 0, ...defaults };
show("before a fraction", fractional);
fractional.delay = 0.5;
show("after a fraction", fractional);

const large: Settings & { large: number } = { large: 0, ...defaults };
large.limit = 2 ** 40;
large.retries = -(2 ** 40);
show("past 32 bits", large);

const atTheEnds: Settings & { atTheEnds: number } = { atTheEnds: 0, ...defaults };
for (const value of [
  -2147483649, -2147483648, -2147483647, -2147483646, -2147483645, -2147483644, -2147483643, -2147483642, 2147483646,
  2147483647, 2147483648,
]) {
  atTheEnds.delay = value;
  console.log("at the ends", atTheEnds.delay, atTheEnds.delay + 1, atTheEnds.delay - 1);
}

const odd: Settings = { retries: -0, delay: NaN, limit: Infinity };
const ofOdd: Settings & { ofOdd: number } = { ofOdd: 0, ...defaults, ...odd };
console.log("odd numbers", Object.is(ofOdd.retries, -0), ofOdd.delay, ofOdd.limit);

const wide: Settings = { retries: 4e9, delay: -4e9, limit: 2 ** 53 };
const ofWide = Object.assign({ ofWide: 0 }, defaults, wide);
show("a wide source", ofWide);

const parsed: Partial<Settings> = JSON.parse(process.argv.length > 99 ? "{}" : '{"delay":1e12,"limit":0.25}');
const ofParsed: Settings & { ofParsed: number } = { ofParsed: 0, ...defaults, ...parsed };
show("out of a text", ofParsed);

const keyed: Settings & { keyed: number } = { keyed: 0, ...defaults };
const key = (["retries", "delay", "limit"] as const)[process.argv.length > 99 ? 0 : 1];
keyed[key] = 1e10;
show("under a key", keyed);

const assignedLater = Object.assign({ assignedLater: 0 }, defaults);
show("before a later assign", assignedLater);
Object.assign(assignedLater, { retries: 3e9 }, parsed);
show("after a later assign", assignedLater);

const emptied: Partial<Settings> & { emptied: number } = { emptied: 0, ...defaults };
emptied.delay = undefined;
delete emptied.limit;
console.log("emptied", emptied.retries, emptied.delay, emptied.limit, "delay" in emptied, "limit" in emptied, JSON.stringify(emptied));

let counted: Settings & { counted: number } = { counted: 0, ...defaults };
for (let i = 0; i < 40; i++) counted = { ...counted, retries: counted.retries * 2 };
show("doubled forty times", counted);
