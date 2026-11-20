// More wide characters than are kept, characters that share a place, kept as keys and elements, across collections.
let digest = 0;
const add = (t: string) => { for (let i = 0; i < t.length; i++) digest = (Math.imul(digest, 31) + t.charCodeAt(i)) | 0; };
const all: string[] = [];
const counts = new Map<string, number>(), table: Record<string, number> = {}, seen = new Set<string>();
for (let round = 0; round < 6; round++) {
  let text = "";
  for (let k = 0; k < 3000; k++) text += String.fromCharCode(0x100 + ((k * 37 + round * 11) % 2500) + (k % 3) * 256);
  for (const c of text) { counts.set(c, (counts.get(c) ?? 0) + 1); table[c] = (table[c] ?? 0) + 1; seen.add(c); if (all.length < 5000) all.push(c); }
  for (let k = 0; k < text.length; k += 3) { const c = text[k]!, d = text.charAt(k + 1), e = text.at(k + 2) ?? ""; add(c + d + e); if (c === text[k + 256]) digest++; }
  const spread = [...text], [first, second] = text.slice(round), parts = text.split("");
  for (let k = 0; k < spread.length; k++) if (spread[k] !== parts[k] || spread[k]!.charCodeAt(0) !== text.charCodeAt(k)) console.log("differs", k);
  add(first! + second!); add(Array.from(text, c => c).join(""));
  Bun.gc(true);
  for (let k = 0; k < 600; k++) { const c = String.fromCharCode(0x4e00 + k * 256), d = String.fromCharCode(0x4e00 + k * 256 + (k & 1)); if ((c === d) !== ((k & 1) === 0)) console.log("same place", k); add([...(c + d)].reverse().join("")); }
}
let sum = 0;
for (const [k, n] of counts) { sum = (sum * 3 + n * k.charCodeAt(0)) % 1000003; if (table[k] !== n || !seen.has(k)) console.log("missing", k); }
for (let k = 0; k < all.length; k++) sum = (sum * 7 + all[k]!.charCodeAt(0)) % 1000003;
console.log(digest, counts.size, sum, all.length);
