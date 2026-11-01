// One function keeps the closure that it is handed and answers with the one that it kept the time before. It is entered through apply from three places, each with instances of a class of its own whose method reads a constant of its block. The second place is a loop, which runs before the constant of the third block has its value.
let kept = () => -1;
function answersWithTheOneBefore(each: { read(): number }) {
  const before = kept;
  kept = () => each.read();
  return before();
}
function inACallback(given: number[]) {
  const made = [...given, 9].flatMap(each => [new (class { held = each; read() { return this.held * 2 + each; } })(), new (class { held = -each; read() { return this.held * 2 + -each; } })()]);
  return [...made].slice(0, 3).flatMap(each => [answersWithTheOneBefore.apply(undefined, [each]), answersWithTheOneBefore.apply(undefined, [each])]).find(each => each > 1);
}
{
  const said = new Set<string>();
  for (let turn = 0; turn < 3; turn++) said.add(JSON.stringify(inACallback(turn % 7 ? [5, 6, 7] : [turn, 1.5])) ?? "nothing");
  console.log("in a callback", [...said].join(" | "));
}
function inALoop() {
  const seen: number[] = [];
  for (let i = 0; i < 4; i++) {
    try {
      if (i % 2) continue;
      seen.push(i);
    } finally {
      const own = { n: i };
      const thing = new (class { held = own.n; read() { return this.held * 2 + own.n; } })();
      seen.push(answersWithTheOneBefore.apply(undefined, [thing]));
    }
  }
  return seen;
}
{
  const said = new Set<string>();
  for (let turn = 0; turn < 3; turn++) said.add(JSON.stringify(inALoop()) ?? "nothing");
  console.log("in a loop", [...said].join(" | "));
}
{
  const given = [5, 6, 7];
  const walk = (left: number, last: { read(): number }): number => {
    if (left === 0) return last.read();
    const ownOfNext = { n: left };
    const next = new (class { held = ownOfNext.n; read() { return this.held * 2 + ownOfNext.n; } })();
    return walk(left - 1, next);
  };
  const ownOfFirst = { n: given.length };
  const first = new (class { held = ownOfFirst.n; read() { return this.held * 2 + ownOfFirst.n; } })();
  console.log("handed down", JSON.stringify(walk(2, first)));
}
export {};
