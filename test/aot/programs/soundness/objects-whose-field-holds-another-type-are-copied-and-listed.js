// A name is a string on one object of a layout and a number, stored under a key that only the run knows, on another. Everything that copies or lists an object sees both.
const names = JSON.parse('["late"]');
function record(i) {
  return { x: i, y: i + 1 };
}
function copies(o) {
  const spread = { ...o };
  const assigned = Object.assign({}, o);
  const { late, ...rest } = o;
  let listed = "";
  for (const k in o) listed += k + "=" + String(o[k]) + ";";
  return [JSON.stringify(spread), JSON.stringify(assigned), String(late), JSON.stringify(rest), listed, JSON.stringify(Object.entries(o)), JSON.stringify(Object.values(o)), JSON.stringify(structuredClone(o)), "late" in o, Object.hasOwn(o, "late")].join(" ");
}
const first = record(1);
first[names[0]] = 5;
const second = record(2);
second.late = "text";
const third = record(3);
console.log(copies(first));
console.log(copies(second));
console.log(copies(third));
let total = 0;
for (let i = 0; i < 3000; i++) total += copies(i % 3 === 0 ? first : i % 3 === 1 ? second : third).length;
console.log(total);
const onto = Object.assign(record(4), first);
const ontoSecond = Object.assign(second, first);
console.log(JSON.stringify(onto), JSON.stringify(ontoSecond), typeof second.late);
