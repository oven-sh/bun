// A word is read out of a view, a buffer or a text, then a text is made, and then the word is used. Nothing names the view, the buffer or the text behind the read.
const size = 40000;
function fresh(text: string): string {
  return JSON.parse(JSON.stringify({ text })).text;
}
{
  let same = 0;
  let other = 0;
  let sum = 0;
  for (let turn = 0; turn < 12000; turn++) {
    const view = new Uint8Array(size);
    view[0] = 7;
    const first = view[0];
    const a = turn * 3;
    const b = turn ^ 5;
    const c = turn + 11;
    const d = turn - 13;
    const e = turn | 64;
    const f = turn & 1023;
    const text = String(turn);
    if (first === 7) same += text.length;
    else other++;
    sum = (sum + a + b + c + d + e + f) | 0;
  }
  console.log("a byte of a Uint8Array", same, other, sum);
}
{
  let same = 0;
  let other = 0;
  let sum = 0;
  for (let turn = 0; turn < 4000; turn++) {
    const view = new Uint8Array(size).fill(7);
    const first = view[size - 1];
    const a = turn * 3;
    const b = turn ^ 5;
    const c = turn + 11;
    const d = turn - 13;
    const e = turn | 64;
    const f = turn & 1023;
    const text = String(turn);
    if (first === 7) same += text.length;
    else other++;
    sum = (sum + a + b + c + d + e + f) | 0;
  }
  console.log("a byte of a Uint8Array that was filled", same, other, sum);
}
{
  let same = 0;
  let other = 0;
  let sum = 0;
  for (let turn = 0; turn < 4000; turn++) {
    const view = new Int32Array(size >> 2).fill(7);
    const first = view[1];
    const a = turn * 3;
    const b = turn ^ 5;
    const c = turn + 11;
    const d = turn - 13;
    const e = turn | 64;
    const f = turn & 1023;
    const text = String(turn);
    if (first === 7) same += text.length;
    else other++;
    sum = (sum + a + b + c + d + e + f) | 0;
  }
  console.log("a word of an Int32Array", same, other, sum);
}
{
  let same = 0;
  let other = 0;
  let sum = 0;
  for (let turn = 0; turn < 4000; turn++) {
    const view = new Uint16Array(size >> 1).fill(7);
    const first = view[1];
    const a = turn * 3;
    const b = turn ^ 5;
    const c = turn + 11;
    const d = turn - 13;
    const e = turn | 64;
    const f = turn & 1023;
    const text = String(turn);
    if (first === 7) same += text.length;
    else other++;
    sum = (sum + a + b + c + d + e + f) | 0;
  }
  console.log("a word of a Uint16Array", same, other, sum);
}
{
  let same = 0;
  let other = 0;
  let sum = 0;
  for (let turn = 0; turn < 4000; turn++) {
    const view = new Float64Array(size >> 3).fill(7);
    const first = view[1];
    const a = turn * 3;
    const b = turn ^ 5;
    const c = turn + 11;
    const d = turn - 13;
    const e = turn | 64;
    const f = turn & 1023;
    const text = String(turn);
    if (first === 7) same += text.length;
    else other++;
    sum = (sum + a + b + c + d + e + f) | 0;
  }
  console.log("a number of a Float64Array", same, other, sum);
}
{
  let same = 0;
  let other = 0;
  let sum = 0;
  for (let turn = 0; turn < 4000; turn++) {
    const view = new DataView(new Uint8Array(size).fill(7).buffer);
    const first = view.getUint8(3);
    const a = turn * 3;
    const b = turn ^ 5;
    const c = turn + 11;
    const d = turn - 13;
    const e = turn | 64;
    const f = turn & 1023;
    const text = String(turn);
    if (first === 7) same += text.length;
    else other++;
    sum = (sum + a + b + c + d + e + f) | 0;
  }
  console.log("a word through a DataView", same, other, sum);
}
{
  let same = 0;
  let other = 0;
  let sum = 0;
  for (let turn = 0; turn < 4000; turn++) {
    const view = Buffer.alloc(size, 7);
    const first = view[5];
    const a = turn * 3;
    const b = turn ^ 5;
    const c = turn + 11;
    const d = turn - 13;
    const e = turn | 64;
    const f = turn & 1023;
    const text = String(turn);
    if (first === 7) same += text.length;
    else other++;
    sum = (sum + a + b + c + d + e + f) | 0;
  }
  console.log("a byte of a Buffer", same, other, sum);
}
{
  let same = 0;
  let other = 0;
  let sum = 0;
  for (let turn = 0; turn < 4000; turn++) {
    const view = fresh("G".repeat(2000) + turn);
    const first = view.charCodeAt(1);
    const a = turn * 3;
    const b = turn ^ 5;
    const c = turn + 11;
    const d = turn - 13;
    const e = turn | 64;
    const f = turn & 1023;
    const text = String(turn);
    if (first === 71) same += text.length;
    else other++;
    sum = (sum + a + b + c + d + e + f) | 0;
  }
  console.log("a code unit of a text", same, other, sum);
}
{
  let same = 0;
  let other = 0;
  let sum = 0;
  for (let turn = 0; turn < 4000; turn++) {
    const view = new Uint8Array(size);
    view[0] = 7;
    const first = view[0];
    const a = turn * 3;
    const b = turn ^ 5;
    const c = turn + 11;
    const d = turn - 13;
    const e = turn | 64;
    const f = turn & 1023;
    const text = [turn, a, b];
    if (first === 7) same += text.length;
    else other++;
    sum = (sum + a + b + c + d + e + f) | 0;
  }
  console.log("a byte in front of a list literal", same, other, sum);
}
{
  let same = 0;
  let other = 0;
  let sum = 0;
  for (let turn = 0; turn < 4000; turn++) {
    const view = new Uint8Array(size);
    view[0] = 7;
    const first = view[0];
    const a = turn * 3;
    const b = turn ^ 5;
    const c = turn + 11;
    const d = turn - 13;
    const e = turn | 64;
    const f = turn & 1023;
    const text = { length: turn & 3, a, b };
    if (first === 7) same += text.length;
    else other++;
    sum = (sum + a + b + c + d + e + f) | 0;
  }
  console.log("a byte in front of an object literal", same, other, sum);
}
