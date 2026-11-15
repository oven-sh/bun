// A quote read by a method of the text in front of a loop, and what every turn reads compared with it: the quote is asked for a 32-bit integer once, in front. Beside it: a parameter of which nothing is known, which is not asked.
// STATISTIC: Int32GuardsHoistedForComparisons >= 1
function makeScanner(initial: string) { let text = initial; let pos = 0; let end = initial.length;
  function unchecked(at: number) { return text.charCodeAt(at); }
  return { setText(next: string) { text = next; pos = 0; end = next.length; },
    until(wanted: unknown): number { const start = pos; while (true) { if (pos >= end) break; const ch = unchecked(pos); if (ch === wanted) { pos++; break; } if (ch === 92) { pos += 2; continue; } pos++; } return pos - start; },
    quoted(at: number): number { const quote = unchecked(at); pos++; const start = pos; while (true) { if (pos >= end) break; const ch = unchecked(pos); if (ch === quote) { pos++; break; } pos++; } return pos - start; } }; }
const scanner = makeScanner("x"); (globalThis as unknown as { kept: unknown }).kept = scanner;
const texts = JSON.parse('["\\"one two\\" three","\'four\' five six","\\u0000zero\\u0000 and more",""]') as string[];
const odd = [0, 1, 2, 3, 5, 8, 13];
for (const text of texts) for (const past of [99, -1, text.length, 4294967296, Infinity]) for (const mostly of [0, 1]) {
  const said: string[] = [];
  for (let call = 0; call < 16; call++) { scanner.setText(text); said.push(String(scanner.quoted(odd.includes(call) === !mostly ? past : 0))); }
  console.log("SAID", JSON.stringify(text), past, mostly, said.join(" "));
}
