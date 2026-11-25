// What comes next under a name is known by what came before: texts that are heads of each other, of 13 to 18 characters, in 8-bit and 16-bit sources.
const texts = ["", "a", "ab", "abc", "abcdefg", "abcdefgh", "abcdefghi", "thirteen chara", "fourteen charac", "fourteen charad", "fifteen charact", "sixteen characte", "sixteen charactf", "seventeen charact", "seventeen charact}", "ÿ", "ÿÿ", "café", "a]", "a}", "quo\"te", "back\\slash", "https://example.com/a/rather/long/path/of/characters/one.js", "https://example.com/a/rather/long/path/of/characters/two.js"];
let hash = 0;
function note(text: string): void { for (let i = 0; i < text.length; i++) hash = (Math.imul(hash, 31) + text.charCodeAt(i)) | 0; }
for (let turn = 0; turn < 12; turn++) {
  const rows: { name: string; url: string; id: number; kind: string }[] = [];
  for (let i = 0; i < 200; i++) rows.push({ name: texts[(i * (turn + 1)) % texts.length]!, url: texts[(i + (i >> 3)) % texts.length]!, id: i, kind: texts[(i % 5 + turn) % texts.length]! });
  if (turn % 3 === 1) rows[7]!.name = "中文";
  if (turn % 3 === 2) rows[7]!.name = "Ā";
  const source = JSON.stringify(rows);
  const again: typeof rows = JSON.parse(source);
  let wrong = 0;
  for (let i = 0; i < rows.length; i++) if (again[i]!.name !== rows[i]!.name || again[i]!.url !== rows[i]!.url || again[i]!.kind !== rows[i]!.kind) wrong++;
  for (const row of again) note(row.name + row.url + row.kind);
  let errors = 0;
  for (let cut = 1; cut < 90; cut++) { try { JSON.parse(source.slice(0, source.length - cut)); } catch { errors++; } }
  let kept = 0;
  for (let i = 0; i < 40; i++) { const one = JSON.stringify(rows[i]); const whole = one + JSON.stringify(rows[i + 1]); if (JSON.parse(whole.slice(0, one.length)).name === rows[i]!.name) kept++; }
  console.log(wrong, errors, kept, hash);
}
