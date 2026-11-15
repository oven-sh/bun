function createScanner() {
  let text: string; let pos: number; let end: number; let base: number;
  function setText(t: string, start: number, length: number, b: number) { text = t; pos = start; end = start + length; base = b; }
  function shifted(): number { return base + 1; }
  function skip(): number {
    let last = -1;
    while (pos < end && text.charCodeAt(pos) === 32) { last = shifted(); pos++; }
    return last;
  }
  return { setText, skip };
}
const s = createScanner();
(globalThis as any).made = createScanner;
s.setText("   x", 0, 4, 7); console.log(s.skip());
