function last(n: number): string {
  const p = { x: n, y: 2 };
  let text = "";
  for (let i = 0; i < n; i++) text = JSON.stringify(p);
  return text;
}
console.log(last(3), last(12));
