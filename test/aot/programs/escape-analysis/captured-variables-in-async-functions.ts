// In an async function, captured variables whose whole lifetime lies between two `await`s can live on the stack; those that are live across an `await` cannot.
async function ahead(n: number): Promise<string> {
  let before = "";
  { //! frame
    let text = "a" + n;
    const parts: string[] = [];
    const grow = function grow(k: number): void { if (k > 0) { text += k; parts.push(text); grow(k - 1); } };
    grow(4);
    before = text + parts.length + parts[3];
  }
  await null;
  let after = "";
  { //! frame
    let text = "b" + n;
    const parts: string[] = [];
    const grow = function grow(k: number): void { if (k > 0) { text += k; parts.push(text); grow(k - 1); } };
    grow(3);
    after = text + parts.length + parts[2];
  }
  return before + "|" + after;
}
async function all(): Promise<void> {
  let out = "";
  for (let i = 0; i < 200; i++) { const r = await ahead(i); if (i % 50 === 0) out += r + "\n"; }
  console.log(out);
}
all();
