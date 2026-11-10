// RUN: link
// A store and a deletion are quoted whole, `in` and `instanceof` with both operands, a loop with its head, a list pattern by itself.
export function probe(holder, list) {
  holder.a.b = list.length;
  delete holder.a.b;
  "b" in holder.a;
  holder instanceof holder.a;
  for (const item of list) item;
  for (const [first] of list) first;
  const [one, { two = 2 }, ...rest] = list;
  [holder.a] = list;
}
// CHECK: quotedSourceText="holder.a.b = list.lengthdelete holder.a.b\x22b\x22 in holder.aholder instanceof holder.aitem of listconst [first] of list[first][one, { two = 2 }, ...rest][holder.a]"
