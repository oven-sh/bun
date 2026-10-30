// The loop compares its counter with the length of a typed array that is as long as its buffer, and reads the characters of a joined text at the elements. One turn resizes the buffer.
function mix(sum: number, next: number): number {
  return (sum * 31 + next * 8) | 0;
}
function work(text: string, at: number, bytes: number): number {
  const places = new Uint8Array(new ArrayBuffer(16, { maxByteLength: 64 }));
  for (let j = 0; j < places.length; j++) places[j] = j * 2;
  let sum = 0;
  for (let j = 0; j < places.length; j++) {
    if (j === at) (places.buffer as ArrayBuffer).resize(bytes);
    sum = mix(sum, text.charCodeAt(places[j]!) | 0);
  }
  return mix(sum, places.length);
}
let total = 0;
for (let i = 0; i < 400; i++) total = mix(total, work("a text that is joined " + i + " of several pieces " + i * 3, i % 20, [0, 4, 24, 64][i & 3]!));
console.log(total);
