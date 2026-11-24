// STATISTIC: LoopNestsInterleaved >= 1
// A variable of the outer loop is set to a constant at the end of every row: the build stopped.
function smooth(values: number[], width: number) {
  let scale = 1.5;
  for (let row = 0; row < 8; row++) {
    let at = row * width, carried = scale;
    for (let column = 0; column < width; column++) {
      carried = (carried * 0.5 + values[at]) * 0.25 + 0.125;
      values[at++] = carried;
    }
    scale = 0.5;
  }
}
const values: number[] = [];
for (let i = 0; i < 96; i++) values.push(i + 0.5);
smooth(values, Number((globalThis as any).missing ?? 12));
console.log("smooth", values.join(" "));
function wholeScale(values: number[], width: number) {
  let scale = 1.5;
  for (let row = 0; row < 8; row++) {
    let at = row * width, carried = scale;
    for (let column = 0; column < width; column++) {
      carried = (carried * 0.5 + values[at]) * 0.25 + 0.125;
      values[at++] = carried;
    }
    scale = 2;
  }
}
const wholeScaleValues: number[] = [];
for (let i = 0; i < 96; i++) wholeScaleValues.push(i + 0.5);
wholeScale(wholeScaleValues, Number((globalThis as any).missing ?? 12));
console.log("wholeScale", wholeScaleValues.join(" "));
function wholeStart(values: number[], width: number) {
  let start = 1;
  for (let row = 0; row < 8; row++) {
    let at = row * width, carried = start;
    for (let column = 0; column < width; column++) {
      carried = (carried * 0.5 + values[at]) * 0.25 + 0.125;
      values[at++] = carried;
    }
    start = 2;
  }
}
const wholeStartValues: number[] = [];
for (let i = 0; i < 96; i++) wholeStartValues.push(i + 0.5);
wholeStart(wholeStartValues, Number((globalThis as any).missing ?? 12));
console.log("wholeStart", wholeStartValues.join(" "));
function skippedCount(values: number[], width: number) {
  let skipped = 1;
  for (let row = 0; row < 8; row++) {
    let at = row * width, carried = skipped * 0.5;
    for (let column = 0; column < width; column++) {
      carried = (carried * 0.5 + values[at]) * 0.25 + 0.125;
      values[at++] = carried;
    }
    skipped = 0;
  }
}
const skippedCountValues: number[] = [];
for (let i = 0; i < 96; i++) skippedCountValues.push(i + 0.5);
skippedCount(skippedCountValues, Number((globalThis as any).missing ?? 12));
console.log("skippedCount", skippedCountValues.join(" "));
function negativeZero(values: number[], width: number) {
  let scale = 4;
  for (let row = 0; row < 8; row++) {
    let at = row * width, carried = 1 / scale;
    for (let column = 0; column < width; column++) {
      carried = (carried * 0.5 + values[at]) * 0.25 + 0.125;
      values[at++] = carried;
    }
    scale = -0;
  }
}
const negativeZeroValues: number[] = [];
for (let i = 0; i < 96; i++) negativeZeroValues.push(i + 0.5);
negativeZero(negativeZeroValues, Number((globalThis as any).missing ?? 12));
console.log("negativeZero", negativeZeroValues.join(" "));
function notANumber(values: number[], width: number) {
  let scale = 1.5;
  for (let row = 0; row < 8; row++) {
    let at = row * width, carried = scale;
    for (let column = 0; column < width; column++) {
      carried = (carried * 0.5 + values[at]) * 0.25 + 0.125;
      values[at++] = carried;
    }
    scale = NaN;
  }
}
const notANumberValues: number[] = [];
for (let i = 0; i < 96; i++) notANumberValues.push(i + 0.5);
notANumber(notANumberValues, Number((globalThis as any).missing ?? 12));
console.log("notANumber", notANumberValues.join(" "));
function pastInt32(values: number[], width: number) {
  let start = 1;
  for (let row = 0; row < 8; row++) {
    let at = row * width, carried = start;
    for (let column = 0; column < width; column++) {
      carried = (carried * 0.5 + values[at]) * 0.25 + 0.125;
      values[at++] = carried;
    }
    start = 4294967296;
  }
}
const pastInt32Values: number[] = [];
for (let i = 0; i < 96; i++) pastInt32Values.push(i + 0.5);
pastInt32(pastInt32Values, Number((globalThis as any).missing ?? 12));
console.log("pastInt32", pastInt32Values.join(" "));
function firstRow(values: number[], width: number) {
  let first = true;
  for (let row = 0; row < 8; row++) {
    let at = row * width, carried = first ? 1.5 : 0.25;
    for (let column = 0; column < width; column++) {
      carried = (carried * 0.5 + values[at]) * 0.25 + 0.125;
      values[at++] = carried;
    }
    first = false;
  }
}
const firstRowValues: number[] = [];
for (let i = 0; i < 96; i++) firstRowValues.push(i + 0.5);
firstRow(firstRowValues, Number((globalThis as any).missing ?? 12));
console.log("firstRow", firstRowValues.join(" "));
function halved(values: number[], width: number) {
  let scale = 1.5;
  for (let row = 0; row < 8; row++) {
    let at = row * width, carried = scale;
    for (let column = 0; column < width; column++) {
      carried = (carried * 0.5 + values[at]) * 0.25 + 0.125;
      values[at++] = carried;
    }
    scale *= 0.5;
  }
}
const halvedValues: number[] = [];
for (let i = 0; i < 96; i++) halvedValues.push(i + 0.5);
halved(halvedValues, Number((globalThis as any).missing ?? 12));
console.log("halved", halvedValues.join(" "));
