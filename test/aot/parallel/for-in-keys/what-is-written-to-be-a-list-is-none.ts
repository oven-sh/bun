// What is written to be a list is an object with indexes, a typed array, `arguments`, a text, a Proxy of a list, or null.
function walk(list: number[]) {
  let text = "";
  for (const i in list) text += i + "=" + list[i as any] + " ";
  return text;
}
function args(..._: number[]) { return (function () { return arguments; } as any)(4, 5); }
function deed() {
  const hostile: unknown[] = [{ 0: 1, 1: 2, x: 3 }, new Uint8Array([7, 8]), args(), "ab", new Proxy([1, 2], {}), null, undefined, JSON.parse('{"2":1,"0":2,"b":3}')];
  let text = "";
  for (let at = 0; at < hostile.length; at++) text += walk(hostile[at] as number[]) + "| ";
  return text;
}
console.log(deed());
for (let round = 0; round < 3; round++) console.log(walk([round, 1]), "#", deed());
