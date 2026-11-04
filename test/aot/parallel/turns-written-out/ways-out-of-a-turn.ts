function firstNegative(...values: number[]): number { for (let i = 0; i < values.length; i++) { if (values[i] < 0) return i; } return -1; }
function untilZero(...values: number[]): number { let s = 0; for (let i = 0; i < values.length; i++) { if (values[i] === 0) break; s += values[i]; } return s; }
function skipsOdd(...values: number[]): number { let s = 0; for (let i = 0; i < values.length; i++) { if (values[i] & 1) continue; s += values[i]; } return s; }
function throwsAt(...values: number[]): number { let s = 0; for (let i = 0; i < values.length; i++) { if (values[i] > 8) throw new RangeError("at " + i); s += values[i]; } return s; }
function catchesInside(...values: number[]): number { let s = 0; for (let i = 0; i < values.length; i++) { try { if (values[i] > 8) throw new RangeError("at " + i); s += values[i]; } catch { s -= 1; } } return s; }
function lastSeen(...values: number[]): string { let i = 0; let last = -1; for (; i < values.length; i++) last = values[i]; return last + ":" + i; }
for (let i = -1; i < 3; i++) {
  console.log(firstNegative(1, i, -5), firstNegative(i), firstNegative(), untilZero(3, i, 4), skipsOdd(i, 2, 3, 4), catchesInside(i, 9, 2), lastSeen(i, 7), lastSeen());
  try { console.log(throwsAt(i, 1, i + 7, 2)); } catch (error) { console.log((error as Error).message); }
}
