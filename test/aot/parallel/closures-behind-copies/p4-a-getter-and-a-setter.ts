function run(sources: Array<{ x: number; y: number }>): string { const said: number[] = [];
  for (let i = 0; i < sources.length; i++) { said.push(i); let hits = 0; const made = { tag: i, ...sources[i], get twice() { return i * 2; }, set twice(value: number) { hits += value; } }; made.twice = 3; said.push(made.twice, hits); } return said.join(" "); }
console.log(`${run([{ x: 1, y: 2 }, { x: 3, y: 4 }, { x: 5, y: 6 }, JSON.parse('{"y":7,"q":8}'), { x: 9, y: 10 }])}`); export {};
