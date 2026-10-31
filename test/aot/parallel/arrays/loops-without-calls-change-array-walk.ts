// The length and the storage of an array are read once in front of a loop that cannot change them. Each loop here can, and calls nothing.
function growsWhileCounted(a: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i];
    if (a.length < 12) a[a.length] = i;
  }
  return sum;
}
function growsWhileIterated(a: number[]): number {
  let sum = 0;
  for (const v of a) {
    sum += v;
    if (a.length < 12) a[a.length] = v + 1;
  }
  return sum;
}
function shrinksWhileCounted(a: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i];
    a.length = a.length - 1;
  }
  return sum;
}
function shrinksWhileIterated(a: number[]): number {
  let sum = 0;
  for (const v of a) {
    sum += v;
    a.length = a.length - 1;
  }
  return sum;
}
function turnsIntoDoubles(a: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i];
    if (i === 1) a[3] = 0.5;
  }
  return sum;
}
function turnsIntoValues(a: (number | string)[]): string {
  let text = "";
  for (const v of a) {
    text += v;
    if (v === 2) a[3] = "four";
  }
  return text;
}
function getsHoles(a: number[]): string {
  let text = "";
  for (let i = 0; i < a.length; i++) {
    text += a[i] + ",";
    if (i === 0) a[6] = 7;
  }
  return text;
}
function getsHolesWhileIterated(a: number[]): string {
  let text = "";
  for (const v of a) {
    text += v + ",";
    if (a.length < 7) a[6] = 7;
  }
  return text;
}
function walksAnother(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i];
    b[b.length] = i;
    if (b.length > 9) break;
  }
  return sum;
}
function keepsMinusZero(a: number[]): string {
  let text = "";
  for (const v of a) text += Object.is(v, -0) ? "-0," : v + ",";
  return text;
}
function swapsTheArray(holder: { list: number[] }, other: number[]): number {
  let sum = 0;
  for (let i = 0; i < holder.list.length; i++) {
    sum += holder.list[i];
    if (i === 1) holder.list = other;
  }
  return sum;
}
for (let round = 0; round < 3; round++) {
  console.log(growsWhileCounted([1, 2, 3]), growsWhileIterated([1, 2, 3]));
  console.log(shrinksWhileCounted([1, 2, 3, 4, 5, 6, 7]), shrinksWhileIterated([1, 2, 3, 4, 5, 6, 7]));
  console.log(turnsIntoDoubles([1, 2, 3, 4, 5]), turnsIntoValues([1, 2, 3, 4, 5]));
  console.log(getsHoles([1, 2, 3]), getsHolesWhileIterated([1, 2, 3]));
  const same = [1, 2, 3];
  console.log(walksAnother(same, same), same.join());
  console.log(walksAnother([1, 2, 3], []), keepsMinusZero([0, -0, 1.5, -0]));
  console.log(swapsTheArray({ list: [1, 2, 3] }, [10, 20, 30, 40, 50]));
  console.log(growsWhileCounted([]), growsWhileIterated([]), shrinksWhileCounted([]), getsHoles([]));
}
