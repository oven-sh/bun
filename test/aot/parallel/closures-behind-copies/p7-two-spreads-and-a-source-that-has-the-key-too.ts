const extras: Array<{ z: number; read?: unknown }> = [{ z: 1 }, { z: 2 }, { z: 3 }, JSON.parse('{"read":5,"z":4}'), { z: 5 }];
function run(sources: Array<{ x: number; y: number }>): string { const said: Array<number | string> = [];
  for (let i = 0; i < sources.length; i++) { said.push(i); const made = { tag: i, ...sources[i], read: () => i, ...extras[i] }, back = { tag: i, ...extras[i], read: () => i }; said.push(typeof made.read, typeof back.read); } return said.join(" "); }
console.log(`${run([{ x: 1, y: 2 }, { x: 3, y: 4 }, { x: 5, y: 6 }, JSON.parse('{"y":7,"q":8}'), { x: 9, y: 10 }])}`); export {};
