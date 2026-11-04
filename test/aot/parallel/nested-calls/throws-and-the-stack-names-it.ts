function outer(bad: boolean) {
  const check = (x: number) => { if (bad) throw new RangeError("no " + x); return x; };
  try { return "ok " + check(1); } catch (e) { return (e as Error).name + ":" + (e as Error).message + ":" + /check/.test((e as Error).stack ?? ""); }
}
console.log(outer(false), outer(true));
