const added: Inner = { a: 1, half: 0.5, big: 4294967296, flag: true };
(added as any).extra = "extra";
type Inner = { a: number; half: number; big: number; flag: boolean };

type Kept = { inner: Inner; note: string; count: number };
function make(source: Inner, note: string, round: number): Kept {
  return { inner: { ...source }, note, count: round };
}
function show(value: unknown): string {
  return JSON.stringify(value, (key, each) => (typeof each === "number" && !Number.isFinite(each) ? String(each) : Object.is(each, -0) ? "-0" : each));
}
let current: Inner = { a: 1, half: 0.5, big: 4294967296, flag: true };
const holdersKept: Kept[] = [];
const innersKept: Inner[] = [];
const bystanders: { before: number; text: string }[] = [];
let digest = 0;
function mix(text: string): void {
  for (let index = 0; index < text.length; index++) digest = (Math.imul(digest, 31) + text.charCodeAt(index)) | 0;
}
for (let round = 0; round < 400; round++) {
  bystanders.push({ before: round, text: "b" + round });
  const holder = make(added, "note " + round, round);
  const inners: Inner[] = [holder.inner];
  current = inners[0];
  if (round % 3 === 0) holdersKept.push(holder);
  if (round % 5 === 0) innersKept.push(inners[inners.length - 1]);
  try {
    if (round % 11 === 0) inners[0].a += 100;
    if (round % 13 === 0) (inners[0] as any).late = round;
    if (round % 17 === 0) Object.freeze(holder);
    if (round % 19 === 0) delete (inners[0] as any).flag;
  } catch (error) {
    mix((error as Error).name + round);
  }
  if (round % 101 === 0) Bun.gc(true);
  if (current.a > 1000) current = { a: 1, half: 0.5, big: 4294967296, flag: true };
  mix(show(holder));
}
Bun.gc(true);
console.log(digest);
mix(show(holdersKept));
console.log(digest);
mix(show(innersKept));
console.log(digest);
console.log(bystanders.filter((each, index) => each.before !== index || each.text !== "b" + index).length, show(current));
console.log(show(holdersKept[holdersKept.length - 1]), Object.keys(innersKept[3]).join());
