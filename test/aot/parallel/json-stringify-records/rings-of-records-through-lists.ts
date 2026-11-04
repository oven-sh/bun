// Records that stand in a ring, each in the list of the one before, and chains of records that end in such a ring.
interface Ring {
  size: number;
  below: Ring[];
}

function ringOf(count: number): Ring {
  const records: Ring[] = [];
  for (let index = 0; index < count; index++) records.push({ size: index, below: [] });
  for (let index = 0; index < count; index++) records[index].below.push(records[(index + 1) % count]);
  return records[0];
}

function chainTo(end: Ring, length: number): Ring {
  let first = end;
  for (let index = 0; index < length; index++) first = { size: index, below: [first] };
  return first;
}

function write(ring: Ring): string {
  try {
    return String(JSON.stringify(ring).length);
  } catch (error) {
    return (error as Error).name + ": " + (error as Error).message;
  }
}

for (const count of [1, 2, 7, 8, 9, 16, 60, 1000]) console.log(count, write(ringOf(count)), write(ringOf(count)));
for (const length of [10, 19_980, 19_990, 19_999, 20_000]) console.log(length, write(chainTo(ringOf(8), length)), write(chainTo(ringOf(60), length)));
console.log(write(chainTo({ size: 0, below: [] }, 100)));
