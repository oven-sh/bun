function run(sources) { const said = [];
  for (let i = 0; i < sources.length; i++) { said.push(i); const made = { tag: i, ...sources[i], hello() { return super.hello() + "!"; } }; Object.setPrototypeOf(made, { hello: () => "base" + i }); said.push(made.hello()); } return said.join(" "); }
console.log(`${run([{ x: 1, y: 2 }, { x: 3, y: 4 }, { x: 5, y: 6 }, JSON.parse('{"y":7,"q":8}'), { x: 9, y: 10 }])}`);
