// Every element of a view is changed and kept between two limits: by the view itself (Uint8ClampedArray), by Math.min and Math.max, by comparisons.
function brightened(length: number, by: number): string {
  const pixels = Uint8ClampedArray.from({ length }, (_, k) => k * 7);
  for (let k = 0; k < pixels.length; k++) pixels[k] = pixels[k]! + by;
  return pixels.join();
}
function brightenedEitherWay(length: number, turn: number): string {
  const pixels = Uint8ClampedArray.from({ length }, (_, k) => k * 5);
  const by = turn & 1 ? 9 : -9;
  for (let k = 0; k < pixels.length; k++) pixels[k] = pixels[k]! + by;
  return pixels.join();
}
function scaled(length: number): string {
  const pixels = Uint8ClampedArray.from({ length }, (_, k) => k * 3);
  for (let k = 0; k < pixels.length; k++) pixels[k] = pixels[k]! * 3 - 100;
  return pixels.join();
}
function scaledBeyondSixteenBits(length: number): string {
  const pixels = Uint8ClampedArray.from({ length }, (_, k) => k * 3);
  for (let k = 0; k < pixels.length; k++) pixels[k] = pixels[k]! * 300 - 40000;
  return pixels.join();
}
function shortsScaledBeyondThirtyTwoBits(length: number): string {
  const shorts = Int16Array.from({ length }, (_, k) => k * 2999);
  for (let k = 0; k < shorts.length; k++) shorts[k] = Math.max(-30000, Math.min(shorts[k]! * 70000, 30000));
  return shorts.join();
}
function bytesBetween(length: number): string {
  const bytes = Uint8Array.from({ length }, (_, k) => k * 11);
  for (let k = 0; k < bytes.length; k++) bytes[k] = Math.min(Math.max(bytes[k]! - 40, 10), 200);
  return bytes.join();
}
function signedBytesBetween(length: number): string {
  const bytes = Int8Array.from({ length }, (_, k) => k * 13);
  for (let k = 0; k < bytes.length; k++) bytes[k] = Math.max(Math.min(bytes[k]! + 100, 127), -128);
  return bytes.join();
}
function shortsBetween(length: number): string {
  const shorts = Int16Array.from({ length }, (_, k) => k * 2999);
  for (let k = 0; k < shorts.length; k++) shorts[k] = Math.max(-30000, Math.min(shorts[k]! * 2, 30000));
  return shorts.join();
}
function unsignedShortsBetween(length: number): string {
  const shorts = Uint16Array.from({ length }, (_, k) => k * 4001);
  for (let k = 0; k < shorts.length; k++) { const next = shorts[k]! + 9000; shorts[k] = next > 65535 ? 65535 : next; }
  return shorts.join();
}
function wordsBetween(length: number): string {
  const words = Int32Array.from({ length }, (_, k) => (k - 20) * 100000007);
  for (let k = 0; k < words.length; k++) words[k] = Math.max(words[k]!, -5);
  return words.join();
}
function greaterOfTwo(length: number): string {
  const left = Uint8Array.from({ length }, (_, k) => k * 17), right = Uint8Array.from({ length }, (_, k) => 255 - k * 9);
  for (let k = 0; k < left.length; k++) left[k] = left[k]! > right[k]! ? left[k]! : right[k]!;
  return left.join();
}

for (const length of [0, 1, 3, 7, 8, 9, 15, 16, 17, 33, 70]) {
  for (const by of [-1000, -256, -255, -9, 0, 9, 255, 256, 1000, 40000, -40000, 2147483647, 0.5, -0.5, NaN]) console.log(length, by, brightened(length, by));
  console.log(length, brightenedEitherWay(length, 0), brightenedEitherWay(length, 1), scaled(length), scaledBeyondSixteenBits(length), shortsScaledBeyondThirtyTwoBits(length), bytesBetween(length), signedBytesBetween(length), shortsBetween(length), unsignedShortsBetween(length), wordsBetween(length), greaterOfTwo(length));
}
