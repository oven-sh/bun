// STATISTIC: SwitchesTestedByWindow >= 6
// Equalities joined by or and switches within 64 values.
function withoutGap(kind: number): boolean {
  return kind === 243 || kind === 244 || kind === 245 || kind === 246 || kind === 247;
}
function withGaps(kind: number): boolean {
  return kind === 10 || kind === 12 || kind === 40 || kind === 73 || kind === 11 || kind === 41;
}
function exactly64Wide(kind: number): boolean {
  return kind === 100 || kind === 163 || kind === 130 || kind === 131;
}
function wider(kind: number): boolean {
  return kind === 100 || kind === 164 || kind === 130 || kind === 131;
}
function aroundZero(kind: number): boolean {
  return kind === -3 || kind === 0 || kind === 2 || kind === -1 || kind === 5;
}
function atTheEnds(kind: number): boolean {
  return kind === 2147483647 || kind === 2147483646 || kind === 2147483640 || kind === 2147483600;
}
function atTheLowEnd(kind: number): boolean {
  return kind === -2147483648 || kind === -2147483647 || kind === -2147483640 || kind === -2147483600;
}
function threePlaces(kind: number): string {
  switch (kind) {
    case 1: case 5: case 9: case 13:
      return "odd";
    case 2: case 6: case 10:
      return "even";
    case 3: case 33:
      return "third";
    default:
      return "none";
  }
}
function fourPlaces(kind: number): string {
  switch (kind) {
    case 1: case 5:
      return "a";
    case 2: case 6:
      return "b";
    case 3:
      return "c";
    case 4:
      return "d";
    default:
      return "none";
  }
}
function leftValueIsKept(kind: number, text: string): boolean | string {
  return kind === 7 || kind === 8 || kind === 9 || kind === 11 || text;
}
function joinedByAnd(kind: number, other: number): boolean {
  return kind !== 7 && kind !== 8 && kind !== 9 && kind !== 11 && other === 1;
}
function ofAnything(kind: unknown): boolean {
  return kind === 20 || kind === 21 || kind === 22 || kind === 25 || kind === 30;
}
const numbers: number[] = [];
for (let i = -70; i <= 330; i++) numbers.push(i);
numbers.push(-0, 0.5, 243.5, 246.0000001, NaN, Infinity, -Infinity, 4294967296 + 243, 4294967296 + 10, -4294967296 + 1, 2147483647, 2147483646, 2147483645, 2147483640, 2147483600, 2147483599, 2147483648,
  -2147483648, -2147483647, -2147483646, -2147483640, -2147483600, -2147483649, 9007199254740991, 1e300);
const lines: string[] = [];
for (const predicate of [withoutGap, withGaps, exactly64Wide, wider, aroundZero, atTheEnds, atTheLowEnd]) {
  const passing: number[] = [];
  for (const n of numbers) if (predicate(n)) passing.push(Object.is(n, -0) ? -0.5 : n);
  lines.push(predicate.name + ": " + passing.join(" "));
}
for (const classify of [threePlaces, fourPlaces]) {
  let text = "";
  for (const n of numbers) { const place = classify(n); if (place !== "none") text += " " + n + "=" + place; }
  lines.push(classify.name + ":" + text);
}
let kept = "";
for (let i = 5; i < 14; i++) kept += " " + String(leftValueIsKept(i, i % 2 ? "" : "t")) + "|" + joinedByAnd(i, i % 3);
lines.push("kept:" + kept);
const odd: unknown[] = [20, 21.0, "20", 25n, null, undefined, true, { valueOf() { return 22; } }, [30], 30, 22, -0, 26, new Number(25)];
lines.push("anything: " + odd.map(ofAnything).join(" "));
console.log(lines.join("\n"));
