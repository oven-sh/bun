function grown(sum: number, rate: number, years: number): number[] {
  const out: number[] = [];
  for (let year = 0; year < years; year++) {
    sum += (sum * rate) / 100;
    out[year] = Math.round(sum * 100) / 100;
  }
  return out;
}
console.log(grown(Number("1000"), 5, 4).join());
