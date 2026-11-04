function byTwo(...values: number[]): number { let s = 0; for (let i = 0; i < values.length; i += 2) s = s * 5 + values[i]; return s; }
function downByTwo(...values: number[]): number { let s = 0; for (let i = values.length - 1; i > 0; i -= 2) s = s * 5 + values[i]; return s; }
function upTo(...values: number[]): number { let s = 0; for (let i = 0; i <= values.length - 1; i++) s = s * 5 + values[i]; return s; }
function boundOnTheLeft(...values: number[]): number { let s = 0; for (let i = 0; values.length > i; i++) s = s * 5 + values[i]; return s; }
function pastTheEnd(...values: number[]): string { let s = ""; for (let i = 0; i <= values.length; i++) s += values[i] + ","; return s; }
function belowZero(...values: number[]): string { let s = ""; for (let i = values.length - 1; i >= -1; i--) s += values[i] + ","; return s; }
function steppedInTheBody(...values: number[]): number { let s = 0; for (let i = 0; i < values.length; i++) { if (values[i] === 1) i++; s = s * 5 + (values[i] ?? 4); } return s; }
function neverTurns(...values: number[]): number { let s = 7; for (let i = values.length; i < values.length; i++) s = 0; return s; }
function twoLoops(...values: number[]): number { let s = 0; for (let i = 0; i < values.length; i++) s += values[i]; for (let j = values.length - 1; j >= 0; j--) s = s * 2 - values[j]; return s; }
function constant(): number { let s = 0; for (let i = 0; i < 4; i++) s = s * 5 + i; for (let i = 8; i > 0; i -= 3) s += i; return s; }
for (let i = 0; i < 3; i++)
  console.log(byTwo(i, 1, 2, 3, 4), downByTwo(i, 1, 2, 3, 4), upTo(i, 1, 2), boundOnTheLeft(i, 1, 2), pastTheEnd(i, 1), belowZero(i, 1), steppedInTheBody(i, 1, 2, 3), neverTurns(i, 1), twoLoops(i, 1, 2), constant());
