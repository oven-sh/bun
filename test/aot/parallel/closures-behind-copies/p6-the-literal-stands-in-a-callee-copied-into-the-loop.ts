function dress(source: { x: number; y: number }, i: number) { return { tag: i, ...source, read: () => i }; }
function run(sources: Array<{ x: number; y: number }>): string { const said: Array<number | boolean | string> = [];
  for (let i = 0; i < sources.length; i++) { said.push(i); const made = dress(sources[i], i); said.push(made.read() === i, Object.keys(made).join("")); } return said.join(" "); }
console.log(`${run([{ x: 1, y: 2 }, { x: 3, y: 4 }, { x: 5, y: 6 }, JSON.parse('{"y":7,"q":8}'), { x: 9, y: 10 }])}`); export {};
