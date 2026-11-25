const encoder = new TextEncoder();
function bytesOf(text: string) {
  return Array.from(encoder.encode(text)).join(" ");
}
const texts = ["", "a", "plain text", "café", "ÿĀ", "€", "😀", "\ud83d", "\ude00x", "a\ud83d", "x".repeat(40) + "é", "\u0000"];
for (const text of texts) console.log(text.length, bytesOf(text));
console.log(bytesOf("left" + String(12) + "right"), encoder.encode().length, encoder.encode(undefined).length, bytesOf(5 as never), bytesOf(null as never));
function into(text: string, room: number) {
  const target = new Uint8Array(room);
  const { read, written } = encoder.encodeInto(text, target);
  return read + " " + written + " | " + Array.from(target).join(" ");
}
for (const text of texts) for (const room of [0, 1, 2, 3, 4, 8]) console.log(text.length, room, into(text, room));
const part = new Uint8Array(new ArrayBuffer(8), 2, 3);
console.log(JSON.stringify(encoder.encodeInto("abcdef", part)), Array.from(new Uint8Array(part.buffer)).join(" "));
try {
  encoder.encodeInto("a", new Uint16Array(2) as never);
} catch (error) {
  console.log((error as Error).constructor.name);
}
