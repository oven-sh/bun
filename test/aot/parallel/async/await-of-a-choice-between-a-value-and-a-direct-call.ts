// One await takes a choice between a plain value and a call of an async function, with values alive over it and another promise beside it: each way waits exactly once.
const log: string[] = [];
const cache = new Map<string, string>();
async function load(key: string) {
  log.push("load " + key);
  await null;
  cache.set(key, "loaded " + key);
  return "loaded " + key;
}
async function get(key: string, turn: number) {
  const label = "turn " + turn;
  const scaled = turn * 1.5;
  const value = await (cache.has(key) ? cache.get(key) : load(key));
  log.push(label + " has " + value);
  return label + " " + scaled + " " + value;
}
function deed(key: string, turn: number) {
  const started = get(key, turn);
  Promise.resolve().then(() => log.push("then 1 of " + turn)).then(() => log.push("then 2 of " + turn)).then(() => log.push("then 3 of " + turn));
  return started;
}
console.log(await deed("a", 0));
console.log(await deed("a", 1));
for (let i = 2; i < 6; i++) console.log(await deed(i % 2 ? "a" : "b" + i, i));
console.log(log.join(" | "));
