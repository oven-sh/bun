// Rest of an awaited step with few members told apart.
// Flags: --aot-limit=MaxValueFlowMembersToldApart:1
async function* count(limit: number) {
  for (let i = 0; i < limit; i++) yield i % 2 ? "odd " + i : i;
  return { last: limit };
}

async function takeOne() {
  const generator = count(4);
  const { value, ...rest } = (await generator.next()) as any;
  return [value, JSON.stringify(rest)];
}

async function takeAll() {
  const generator = count(3);
  const seen: unknown[] = [];
  for (;;) {
    const { value, ...rest } = (await generator.next()) as any;
    seen.push(value, rest);
    if (rest.done) return seen;
  }
}

async function copyOne() {
  const generator = count(2);
  const { ...copy } = (await generator.next()) as any;
  const other = ((await generator.next()) as any) ?? { value: "nothing" };
  return [copy, other, Object.keys(other)];
}

console.log(JSON.stringify(await takeOne()));
console.log(JSON.stringify(await takeAll()));
console.log(JSON.stringify(await copyOne()));
