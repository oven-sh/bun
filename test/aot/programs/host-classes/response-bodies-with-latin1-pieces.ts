// A piece of a page that is Latin-1 and holds a character beyond ASCII is written as UTF-8 eight characters at a time. Every place of such a character in a word, runs of them, and pieces of every short length give the bytes that a flattened string gives.
const filler = "0123456789abcdef".repeat(20);
function page(first: string, second: string, third: string): Response {
  return new Response(`<a>${first}</a><b>${second}</b><c>${third}</c>${filler}`, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
}
const seen: string[] = [];
function shared(first: string, second: string): Response {
  const body = `<a>${first}</a><b>${second}</b>${filler}`;
  seen.push(body);
  return new Response(body, { status: 200 });
}
const lines: string[] = [];
let sum = 0;
async function take(response: Response): Promise<string> {
  const bytes = new Uint8Array(await response.arrayBuffer());
  sum = (sum * 31 + Bun.hash.crc32(bytes) + bytes.length) % 1000000007;
  return Bun.hash.crc32(bytes).toString(16) + "/" + bytes.length;
}
const plain = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ".repeat(8);
const beyond = ["\u0080", " ", "·", "¿", "À", "é", "ÿ"];
for (let length = 1; length <= 72; length++) {
  for (let at = 0; at < length; at++) {
    const character = beyond[(length + at) % beyond.length]!;
    const piece = plain.slice(0, at) + character + plain.slice(at + 1, length);
    await take(page(piece, "x", plain.slice(0, length)));
  }
}
lines.push("one character beyond ASCII at every place of pieces of 1 to 72: " + sum);
for (const length of [127, 128, 129, 130, 143, 144, 145, 255, 256, 257, 1000, 4095, 4096, 4097, 20000]) {
  const long = plain.repeat(Math.ceil(length / plain.length)).slice(0, length);
  const places = [0, 1, 7, 8, 9, 15, 16, 63, 64, length >> 1, length - 9, length - 8, length - 2, length - 1].filter(at => at >= 0 && at < length);
  const answers: string[] = [];
  for (const at of places) answers.push(await take(page(long.slice(0, at) + "é" + long.slice(at + 1), long, "ÿ")));
  lines.push(length + ": " + answers.join(" "));
}
for (const run of [1, 2, 7, 8, 9, 16, 17, 100, 5000]) {
  lines.push("a run of " + run + ": " + (await take(page("ü".repeat(run), "a" + "\u0080".repeat(run) + "z", plain + "ÿ".repeat(run)))));
  lines.push("every other, " + run + ": " + (await take(page("aé".repeat(run), "éa".repeat(run), "abcdefgé".repeat(run)))));
}
lines.push("only ASCII: " + (await take(page(plain, plain.slice(3), ""))));
lines.push("a wide piece between: " + (await take(page(plain + "é", "東京", "é" + plain))));
lines.push("a slice of a wide text that is Latin-1: " + (await take(page(("東" + plain + "é" + plain).slice(1), "", ""))));
lines.push("shared: " + (await take(shared(plain + "é" + plain, "ÿ"))) + " " + seen[0]!.length);
lines.push("as text: " + (await page("café · naïve", "ÿ".repeat(3), plain.slice(0, 9) + "é").text()).slice(0, 60));
console.log(lines.join("\n"));
