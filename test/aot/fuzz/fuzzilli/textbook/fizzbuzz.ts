function said(upTo: number): string[] {
  const out: string[] = [];
  for (let i = 1; i <= upTo; i++) {
    out.push(i % 15 === 0 ? "fizzbuzz" : i % 5 === 0 ? "buzz" : i % 3 === 0 ? "fizz" : String(i));
  }
  return out;
}
console.log(said(Number("15")).join());
