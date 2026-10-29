// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
{
  console.log([1, 2, 3].at(-1));
}
{
  console.log([1, 2, 3].every(n => n > 0));
}
{
  console.log([1, 2, 3].filter(n => n > 1).length);
}
{
  console.log([1, 2, 3].find(n => n > 1));
}
{
  console.log([1, 2, 3].findIndex(n => n > 1));
}
{
  console.log([1, 2, 3].findLast(n => n < 3));
}
{
  console.log([1, 2, 3].findLastIndex(n => n < 3));
}
{
  console.log([1, 2].flatMap(n => [n, n]).length);
}
{
  [1, 2].forEach(n => console.log(n));
}
{
  console.log([1, 2, 3].reduce((sum, n) => sum + n, 0));
}
{
  console.log(["a", "b"].reduceRight((all, s) => all + s, ""));
}
{
  console.log([1, 2, 3].some(n => n > 2));
}
{
  console.log(new Uint8Array([1, 2, 3]).at(-1));
}
{
  console.log(new Uint8Array([1, 2]).toLocaleString("en-US"));
}
{
  console.log(Array.from(new Set([1, 2]), n => n * 2).length, Array.from({ length: 2, 0: "a", 1: "b" }).length);
}
{
  console.log(Object.fromEntries([["a", 1]]).a, Object.fromEntries(new Map([["b", 2]])).b);
}
{
  console.log(Map.groupBy([1, 2, 3], n => n % 2).size);
}
{
  new Set(["a"]).forEach(value => console.log(value));
}
{
  console.log(Reflect.apply(Math.max, null, [1, 3, 2]));
}
{
  const holder = { a: 1 };
  console.log(Reflect.deleteProperty(holder, "a"), "a" in holder);
}
{
  console.log(Reflect.has({ a: 1 }, "a"));
}
{
  function add(a, b) {
    return this.base + a + b;
  }
  console.log(add.call({ base: 1 }, 2, 3));
}
{
  console.log([1, 2, 3].values().drop(1).next().value);
}
{
  console.log([1, 2, 3].values().every(n => n > 0));
}
{
  console.log(
    [1, 2, 3]
      .values()
      .filter(n => n > 1)
      .next().value,
  );
}
{
  console.log([1, 2, 3].values().find(n => n > 1));
}
{
  [1, 2].values().forEach(n => console.log(n));
}
{
  console.log(
    [1, 2]
      .values()
      .map(n => n * 2)
      .next().value,
  );
}
{
  console.log([1, 2, 3].values().reduce((sum, n) => sum + n, 0));
}
{
  console.log([1, 2, 3].values().some(n => n > 2));
}
{
  console.log([1, 2, 3].values().take(1).next().value);
}
{
  console.log([1, 2, 3].values().toArray().length);
}
{
  console.log([1, 2, 3].values().chunks(2).next().value.length);
}
{
  console.log([1, 2, 3].values().windows(2).next().value.length);
}
{
  console.log(Iterator.concat([1], [2]).next().value);
}
{
  console.log(
    Iterator.from({
      next() {
        return { done: false, value: 7 };
      },
    }).next().value,
  );
}
{
  console.log(Iterator.zip([[1], [2]]).next().value.length);
}
{
  {
    using held = {
      [Symbol.dispose]() {
        console.log("disposed");
      },
    };
    console.log("inside");
  }
}
{
  const list = [1, 2, 3];
  for (const n of list) console.log(n);
  const [first, ...rest] = list;
  console.log(Math.max(...list), first, rest.length, [...list, 4].length);
}
