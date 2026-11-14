const order: string[] = [], key = (name: string) => (order.push(name), name);
function run(sources: Array<{ x: number; y: number }>): string { const said: Array<number | boolean | string> = [];
  for (let i = 0; i < sources.length; i++) { said.push(i); const made: any = { tag: i, ...sources[i], [key("k" + i)]: () => i, after: () => order.length }; said.push(made["k" + i]() === i, made["k" + i].name, made.after()); } return said.join(" "); }
console.log(`${run([{ x: 1, y: 2 }, { x: 3, y: 4 }, { x: 5, y: 6 }, JSON.parse('{"y":7,"q":8}'), { x: 9, y: 10 }])}`); export {};
