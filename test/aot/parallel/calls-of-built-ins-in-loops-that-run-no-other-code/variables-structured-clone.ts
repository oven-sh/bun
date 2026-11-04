function make() {
  let text = ""; let other = ""; let i = 0; let n = 0; let sum = 0;
  const box: { a: number; b?: number } = { a: 1 }; const list = [1, 2, 3]; const map = new Map<number, number>([[1, 2]]); const set = new Set<number>([1]); const bytes = new Uint8Array(4); const date = new Date(5); const sticky = /c/g;
  function run() { while (i < n) { sum += Number(structuredClone(box).a); i++; } return String(Math.round(sum * 1000)); }
  function set3(a: string, b: string, c: number) { text = a; other = b; n = c; i = 0; sum = 0; }
  return { run, set3 };
}
const made = make(); (globalThis as any).made = made;
made.set3("abcde", "a", 7); const first = made.run(); made.set3("", "", 3);
console.log(first, made.run());
