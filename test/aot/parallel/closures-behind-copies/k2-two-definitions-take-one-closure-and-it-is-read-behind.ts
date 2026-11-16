function run(sources: Array<{ x: number; y: number }>): string {
  const said: Array<number | boolean> = [];
  for (let i = 0; i < sources.length; i++) {
    said.push(i);
    let kept: (() => number) | undefined;
    const made = { tag: i, ...sources[i], first: (kept = () => i), second: kept };
    said.push(made.first === made.second, made.second === kept);
  }
  return said.join(" ");
}
console.log(`${run([{ x: 1, y: 2 }, { x: 3, y: 4 }, { x: 5, y: 6 }, JSON.parse('{"y":7,"q":8}'), { x: 9, y: 10 }])}`);
export {};
