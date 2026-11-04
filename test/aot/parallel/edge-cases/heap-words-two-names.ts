// Two names of one value share a heap word in a long async function. `first = null` clears the word, and the second name fills it again.
type Item = { id: number };

async function add(item: Item): Promise<number> {
  const seen: number[] = [];
  let first: Item | null = item;
  seen.push(await 0, first.id);
  seen.push(await 1, first.id);
  seen.push(await 2, first.id);
  seen.push(await 3, first.id);
  seen.push(await 4, first.id);
  seen.push(await 5, first.id);
  seen.push(await 6, first.id);
  seen.push(await 7, first.id);
  seen.push(await 8, first.id);
  seen.push(await 9, first.id);
  seen.push(await 10, first.id);
  seen.push(await 11, first.id);
  seen.push(await 12, first.id);
  seen.push(await 13, first.id);
  seen.push(await 14, first.id);
  seen.push(await 15, first.id);
  seen.push(await 16, first.id);
  seen.push(await 17, first.id);
  first = null;
  const second: Item | undefined = item;
  seen.push(await 0, second.id);
  seen.push(await 1, second.id);
  seen.push(await 2, second.id);
  seen.push(await 3, second.id);
  seen.push(await 4, second.id);
  seen.push(await 5, second.id);
  seen.push(await 6, second.id);
  seen.push(await 7, second.id);
  seen.push(await 8, second.id);
  seen.push(await 9, second.id);
  seen.push(await 10, second.id);
  seen.push(await 11, second.id);
  seen.push(await 12, second.id);
  seen.push(await 13, second.id);
  seen.push(await 14, second.id);
  seen.push(await 15, second.id);
  seen.push(await 16, second.id);
  seen.push(await 17, second.id);
  return seen.reduce((sum, n) => sum + n, first === null ? 1000 : 0);
}

add({ id: 3 }).then(sum => console.log(sum));
