// A spread under a declared type whose source is an ordinary object fills members kept outside the cell without a frame, and takes the other way for a value that does not go there.
interface Point { a?: number; b?: number; c?: string; d?: number }
function filled(a: unknown, b: unknown, c: unknown, d: unknown): any {
  const made: any = {};
  const values: Record<string, unknown> = { a, b, c, d };
  for (const name of ["a", "b", "c", "d"]) made[name] = values[name];
  return made;
}
function copy(source: any): Point {
  const point: Point = source;
  return { ...point };
}
const list = [filled(1, 2, "c", 4), filled(5, 6, "t", 8)];
let sum = 0;
for (let i = 0; i < 30000; i++) {
  const made = copy(list[i & 1]);
  sum = (sum + (made.a ?? 0) + (made.d ?? 0) + (made.c?.length ?? 0)) % 1000003;
}
console.log(sum);
function show(source: any) {
  const made = copy(source);
  console.log(JSON.stringify(Reflect.ownKeys(made).map(key => [String(key), typeof made[key as keyof Point], made[key as keyof Point]])));
  (made as any).extra = 1;
  made.a = 100;
  console.log(JSON.stringify(made), JSON.stringify(source));
}
show(filled(1.5, 2, "c", 4));
show(filled("not a number", 2, "c", 4));
show(filled(1, undefined, "c", 4));
show(filled(1, null, "c", 4));
show(filled(1, 2, 3, 4));
show(filled(2147483647, -2147483648, "", 0));
show(filled({ deep: 1 }, [1], true, Symbol.iterator.description));
const shuffled: any = {};
for (const name of ["d", "c", "b", "a"]) shuffled[name] = name;
show(shuffled);
const some: any = {};
for (const name of ["b", "d"]) some[name] = 1;
show(some);
const more = filled(1, 2, "c", 4);
more.e = "more";
show(more);
const gone = filled(1, 2, "c", 4);
delete gone.b;
show(gone);
for (let round = 0; round < 40000; round++) {
  if (round % 10000 === 0) {
    const pile: any[] = [];
    for (let i = 0; i < 2000; i++) pile.push(copy(list[i & 1]));
    (globalThis as any).Bun?.gc?.(round % 20000 === 0);
    sum = (sum + pile.reduce((all, made) => all + (made.a ?? 0) + (made.c?.length ?? 0), 0)) % 1000003;
  }
  sum = (sum + (copy(list[round & 1]).b ?? 0)) % 1000003;
}
console.log(sum);
