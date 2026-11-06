let sum = 0;
const encoder = new TextEncoder(), decoder = new TextDecoder();
const text = "The quick brown fox jumps over the lazy dog. ünïcödé ✓ ".repeat(40);
for (let i = 0; i < 6000; i++) {
  const buffer = Buffer.from(text + i);
  sum += buffer.toString("base64").length + buffer.toString("hex").length + buffer.toString("latin1").length + buffer.indexOf("lazy") + buffer.readUInt32LE(i % 64);
  sum += Buffer.from(buffer.toString("base64"), "base64").equals(buffer) ? 1 : 0;
  sum += decoder.decode(encoder.encode(text)).length + Buffer.concat([buffer, buffer.subarray(3, 90)]).length + Buffer.byteLength(text);
  const made = Buffer.alloc(256); made.writeDoubleBE(i, 8); made.fill(i & 255, 16, 200); made.copy(buffer, 0, 0, 64); sum += made[17] + Buffer.compare(made, buffer);
  sum += atob(btoa("plain text " + i)).length + structuredClone({ i, list: [i] }).list[0];
}
console.log(sum);
