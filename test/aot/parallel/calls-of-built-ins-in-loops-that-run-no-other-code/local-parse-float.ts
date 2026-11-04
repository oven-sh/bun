function run(text: string, other: string, n: number): string {
  const box: { a: number; b?: number } = { a: 1 }; const list = [1, 2, 3]; const map = new Map<number, number>([[1, 2]]); const set = new Set<number>([1]); const bytes = new Uint8Array(4); const date = new Date(5); const sticky = /c/g;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += Number(parseFloat("1.5e" + i));
  return String(Math.round(sum * 1000));
}
console.log(run("abcde", "a", 7), run("", "", 3));
