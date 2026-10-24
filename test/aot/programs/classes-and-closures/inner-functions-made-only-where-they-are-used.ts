// An inner function that only some paths use is one function object for each call of the outer function, whichever of those paths asks for it and however often.
const lines: string[] = [];
function say(...values: unknown[]) {
  lines.push(values.map(String).join(" "));
}

const seen: Function[] = [];
function keep(callback: Function) {
  seen.push(callback);
  return seen.length;
}

function early(skip: boolean, turns: number): number {
  if (skip) return -1;
  let sum = 0;
  for (let i = 0; i < turns; i++) sum += keep(helper);
  return sum;
  function helper() { return 1; }
}
say("skipped", early(true, 3), seen.length);
say("in a loop", early(false, 3), seen.length, seen[0] === seen[1], seen[1] === seen[2]);
say("another call", early(false, 2), seen.length, seen[3] === seen[4], seen[2] !== seen[3]);

function twoArms(skip: boolean, first: boolean): boolean {
  if (skip) return false;
  let one: Function | undefined;
  if (first) one = helper;
  const other: Function = helper;
  return one === undefined || one === other;
  function helper() { return 2; }
}
say("two arms", twoArms(true, true), twoArms(false, true), twoArms(false, false));

function capturing(skip: boolean, base: number, turns: number): number[] {
  if (skip) return [];
  const results: number[] = [];
  const callbacks: (() => number)[] = [];
  for (let i = 0; i < turns; i++) {
    callbacks.push(next);
    results.push(next());
  }
  results.push(new Set(callbacks).size);
  return results;
  function next() { return ++base; }
}
say("capturing", capturing(true, 1, 1).length, capturing(false, 10, 3).join(), capturing(false, 20, 1).join());

function withProperties(skip: boolean): string {
  if (skip) return "skipped";
  for (let i = 0; i < 3; i++) (tagged as { count?: number }).count = ((tagged as { count?: number }).count ?? 0) + 1;
  return tagged.name + " " + (tagged as { count?: number }).count;
  function tagged() {}
}
say("properties", withProperties(true), withProperties(false), withProperties(false));

function thrown(skip: boolean): string {
  if (skip) return "skipped";
  try {
    for (let i = 0; i < 2; i++) if (i === 1) throw helper;
    return "nothing";
  } catch (error) {
    return String(error === helper) + " " + (error as () => string)();
  }
  function helper() { return "caught"; }
}
say("thrown", thrown(true), thrown(false));

console.log(lines.join("\n"));
