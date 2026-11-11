// The built-in gets no argument, too many, a text, an object with valueOf.
type Table = { handler: (...x: any[]) => number };
function main() {
  const own: Table = { handler: (...x) => x.length }, native: Table = { handler: Math.abs };
  let calls = 0;
  const box = { valueOf() { calls++; return -4; } };
  const said: string[] = [];
  for (let i = 0; i < 200; i++) {
    const table = i & 1 ? own : native;
    said.push([table.handler(), table.handler(-1, -2), table.handler("-3"), table.handler(box), table.handler(null), table.handler(undefined)].join("/"));
  }
  console.log(said[0], said[1], new Set(said).size, calls);
}
main();
