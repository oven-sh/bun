function guarded(f: () => number, fallback: () => number): number {
  let chosen = f;
  try { if (f() < 0) throw new Error("negative"); } catch { chosen = fallback; }
  return chosen();
}
function work(k: number): number { return guarded(() => k, () => -k * 10); }
console.log(work(2), work(-3));
