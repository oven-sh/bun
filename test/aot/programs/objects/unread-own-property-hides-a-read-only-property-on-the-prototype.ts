// Each object has an own property that nothing reads, and its prototype is frozen and has a property of the same name. A store by name goes to the own property and does not throw.
class Named {
  label = 0;
  kept = 1;
}
class Source {
  value = 1;
}
function setLabel(target: Named, source: Source) {
  target.label = source.value;
}
setLabel(new Named(), new Source());
setLabel(JSON.parse("{}"), new Source());
const parsed = JSON.parse(`{"value": 3}`);
const prototype = Object.freeze({ label: 7 });
function create(kept: number) {
  return { __proto__: prototype, label: 1, kept };
}
const list: any[] = [];
for (let i = 0; i < 3; i++) list.push(create(i));
try {
  for (const each of list) setLabel(each, parsed);
  console.log("stored");
} catch (error) {
  console.log((error as Error).name);
}
let sum = 0;
for (const each of list) sum += each.kept;
console.log(sum);
