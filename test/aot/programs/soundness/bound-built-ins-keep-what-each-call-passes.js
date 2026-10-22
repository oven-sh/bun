// One call site calls three bound functions over one built-in: what each passes is kept by the receiver that was bound with it.
function main() {
  const first = [], second = [], third = new Map();
  const pushes = [first.push.bind(first), second.push.bind(second, "bound"), first.push.bind(second)];
  function add(push, v) { const o = { v }; return push(o); }
  const lengths = [];
  for (let i = 0; i < 3; i++) lengths.push(add(pushes[i], i ? "text" + i : i));
  console.log(lengths.join(), first.length, second.length);
  console.log(typeof first[0].v, typeof second[0], typeof second[1].v, typeof second[2].v);
  const sets = [third.set.bind(third, "a"), third.set.bind(third, "b", 1), third.set.bind(third)];
  for (let i = 0; i < 3; i++) sets[i]({ n: i }, "second");
  console.log(typeof third.get("a"), typeof third.get("b"), third.size);
  let kinds = "";
  for (const [k, v] of third) kinds += typeof k + ":" + typeof v + ";";
  console.log(kinds);
  const holders = [{ x: 0 }, { x: 0 }, { x: 0 }];
  const stores = [Reflect.set.bind(null, holders[0], "x"), Reflect.set.bind(null, holders[1], "x", "bound value"), Reflect.set.bind(null, holders[2])];
  for (let i = 0; i < 3; i++) stores[i](i === 2 ? "x" : { stored: i }, { second: i });
  console.log(typeof holders[0].x, typeof holders[1].x, typeof holders[2].x, holders[0].x.stored, holders[2].x.second);
}
main();
