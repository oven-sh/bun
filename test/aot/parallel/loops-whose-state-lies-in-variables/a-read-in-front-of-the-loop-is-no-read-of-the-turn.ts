function createScanner() {
  let text: string;
  let pos: number;
  let end: number;
  function setText(t: string, start: number, length: number) { text = t; pos = start; end = start + length; }
  function skip(): number {
    const start = pos;
    let last = -1;
    while (start < end && text.charCodeAt(pos) === 32) { last = pos; pos++; }
    return last;
  }
  return { setText, skip };
}
const s = createScanner();
(globalThis as any).made = createScanner;
s.setText("    x", 0, 5); console.log(s.skip());
s.setText("  y", 0, 3); console.log(s.skip());
