// A heap word goes on from one value to the next inside a loop of a long async function. The next turn fills it again, also for a second name of a value that was stored in front of the loop.
type Item = { id: number };

async function add(item: Item, turns: number): Promise<number> {
  const seen: number[] = [];
  const before: Item | null = item;
  seen.push(await 0, before.id);
  seen.push(await 1, before.id);
  seen.push(await 2, before.id);
  seen.push(await 3, before.id);
  seen.push(await 4, before.id);
  seen.push(await 5, before.id);
  seen.push(await 6, before.id);
  seen.push(await 7, before.id);
  seen.push(await 8, before.id);
  seen.push(await 9, before.id);
  seen.push(await 10, before.id);
  seen.push(await 11, before.id);
  seen.push(await 12, before.id);
  seen.push(await 13, before.id);
  seen.push(await 14, before.id);
  seen.push(await 15, before.id);
  seen.push(await 16, before.id);
  seen.push(await 17, before.id);
  for (let turn = 0; turn < turns; turn++) {
    const inside: Item | undefined = item;
    seen.push(await 0, inside.id);
    seen.push(await 1, inside.id);
    seen.push(await 2, inside.id);
    seen.push(await 3, inside.id);
    seen.push(await 4, inside.id);
    seen.push(await 5, inside.id);
    seen.push(await 6, inside.id);
    seen.push(await 7, inside.id);
    seen.push(await 8, inside.id);
    seen.push(await 9, inside.id);
    seen.push(await 10, inside.id);
    seen.push(await 11, inside.id);
    seen.push(await 12, inside.id);
    seen.push(await 13, inside.id);
    seen.push(await 14, inside.id);
    seen.push(await 15, inside.id);
    seen.push(await 16, inside.id);
    seen.push(await 17, inside.id);
    const other = { id: turn * 100 };
    seen.push(await 0, other.id);
    seen.push(await 1, other.id);
    seen.push(await 2, other.id);
    seen.push(await 3, other.id);
    seen.push(await 4, other.id);
    seen.push(await 5, other.id);
    seen.push(await 6, other.id);
    seen.push(await 7, other.id);
    seen.push(await 8, other.id);
    seen.push(await 9, other.id);
    seen.push(await 10, other.id);
    seen.push(await 11, other.id);
    seen.push(await 12, other.id);
    seen.push(await 13, other.id);
    seen.push(await 14, other.id);
    seen.push(await 15, other.id);
    seen.push(await 16, other.id);
    seen.push(await 17, other.id);
  }
  return seen.reduce((sum, n) => sum + n, 0);
}

add({ id: 1 }, 3).then(sum => console.log(sum));
