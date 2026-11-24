// STATISTIC: LoopNestsInterleaved >= 1
// The row counter is set to a constant at the end of a row: the build stopped.
function smooth(values: number[], width: number) {
  for (let row = 0; row < 8; row++) {
    let at = row * width, carried = 1.5;
    for (let column = 0; column < width; column++) {
      carried = (carried * 0.5 + values[at]) * 0.25 + 0.125;
      values[at++] = carried;
    }
    row = 2147483647;
  }
}
const values: number[] = [];
for (let i = 0; i < 96; i++) values.push(i + 0.5);
smooth(values, Number((globalThis as any).missing ?? 12));
console.log("smooth", values.join(" "));
function endAtHundred(values: number[], width: number) {
  for (let row = 0; row < 8; row++) {
    let at = row * width, carried = 1.5;
    for (let column = 0; column < width; column++) {
      carried = (carried * 0.5 + values[at]) * 0.25 + 0.125;
      values[at++] = carried;
    }
    row = 100;
  }
}
const endAtHundredValues: number[] = [];
for (let i = 0; i < 96; i++) endAtHundredValues.push(i + 0.5);
endAtHundred(endAtHundredValues, Number((globalThis as any).missing ?? 12));
console.log("endAtHundred", endAtHundredValues.join(" "));
function endPastInt32(values: number[], width: number) {
  for (let row = 0; row < 8; row++) {
    let at = row * width, carried = 1.5;
    for (let column = 0; column < width; column++) {
      carried = (carried * 0.5 + values[at]) * 0.25 + 0.125;
      values[at++] = carried;
    }
    row = 2147483648;
  }
}
const endPastInt32Values: number[] = [];
for (let i = 0; i < 96; i++) endPastInt32Values.push(i + 0.5);
endPastInt32(endPastInt32Values, Number((globalThis as any).missing ?? 12));
console.log("endPastInt32", endPastInt32Values.join(" "));
function endPastUint32(values: number[], width: number) {
  for (let row = 0; row < 8; row++) {
    let at = row * width, carried = 1.5;
    for (let column = 0; column < width; column++) {
      carried = (carried * 0.5 + values[at]) * 0.25 + 0.125;
      values[at++] = carried;
    }
    row = 4294967296;
  }
}
const endPastUint32Values: number[] = [];
for (let i = 0; i < 96; i++) endPastUint32Values.push(i + 0.5);
endPastUint32(endPastUint32Values, Number((globalThis as any).missing ?? 12));
console.log("endPastUint32", endPastUint32Values.join(" "));
function plainRows(values: number[], width: number) {
  for (let row = 0; row < 8; row++) {
    let at = row * width, carried = 1.5;
    for (let column = 0; column < width; column++) {
      carried = (carried * 0.5 + values[at]) * 0.25 + 0.125;
      values[at++] = carried;
    }
  }
}
const plainRowsValues: number[] = [];
for (let i = 0; i < 96; i++) plainRowsValues.push(i + 0.5);
plainRows(plainRowsValues, Number((globalThis as any).missing ?? 12));
console.log("plainRows", plainRowsValues.join(" "));
function raised(values: number[], width: number) {
  for (let row = 0; row < 8; row++) {
    let at = row * width, carried = 1.5;
    for (let column = 0; column < width; column++) {
      carried = (carried * 0.5 + values[at]) * 0.25 + 0.125;
      values[at++] = carried;
    }
    row += 2147483647;
  }
}
const raisedValues: number[] = [];
for (let i = 0; i < 96; i++) raisedValues.push(i + 0.5);
raised(raisedValues, Number((globalThis as any).missing ?? 12));
console.log("raised", raisedValues.join(" "));
function conditional(values: number[], width: number) {
  for (let row = 0; row < 8; row++) {
    let at = row * width, carried = 1.5;
    for (let column = 0; column < width; column++) {
      carried = (carried * 0.5 + values[at]) * 0.25 + 0.125;
      values[at++] = carried;
    }
    if (width > 100) row = 2147483647;
  }
}
const conditionalValues: number[] = [];
for (let i = 0; i < 96; i++) conditionalValues.push(i + 0.5);
conditional(conditionalValues, Number((globalThis as any).missing ?? 12));
console.log("conditional", conditionalValues.join(" "));
