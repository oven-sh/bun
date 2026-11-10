// A quote read by a method of the text in front of a loop, and what every turn reads compared with it: the quote is asked for a 32-bit integer once, in front. Beside it: a parameter of which nothing is known, which is not asked.
// STATISTIC: ValuesComparedWithIntegersAskedOnceInFrontOfLoops >= 1
function makeScanner(initial: string) { let text = initial; let pos = 0; let end = initial.length;
  function unchecked(at: number) { return text.charCodeAt(at); }
  return { setText(next: string) { text = next; pos = 0; end = next.length; },
    until(wanted: unknown): number { const start = pos; while (true) { if (pos >= end) break; const ch = unchecked(pos); if (ch === wanted) { pos++; break; } if (ch === 92) { pos += 2; continue; } pos++; } return pos - start; },
    quoted(): number { const quote = unchecked(pos); pos++; const start = pos; while (true) { if (pos >= end) break; const ch = unchecked(pos); if (ch === quote) { pos++; break; } pos++; } return pos - start; } }; }
const scanner = makeScanner("x"); (globalThis as unknown as { kept: unknown }).kept = scanner;
const texts = JSON.parse('["\\"one two\\" three","\'four\' five six","\\u0000zero\\u0000 and more",""]') as string[];
const out: string[] = [];
const all: unknown[] = [JSON.parse("68.5") - 34.5, JSON.parse("1e2") / 2.5 - 1, -0, JSON.parse("-0")];
for (let round = 0; round < 3; round++) for (const text of texts) { for (const wanted of all) { scanner.setText(text); out.push(String(scanner.until(wanted))); } scanner.setText(text); out.push("q" + scanner.quoted()); }
console.log(out.join(" "));
