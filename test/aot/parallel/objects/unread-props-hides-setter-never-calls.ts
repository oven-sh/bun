// Each object has an own property that nothing reads, and its prototype has a setter of the same name that nothing calls. A store by name goes to the own property.
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
const prototype = {
  set label(value: number) {
    console.log("the setter ran", value);
  },
};
function create(kept: number) {
  return { __proto__: prototype, label: 1, kept };
}
const list: any[] = [];
for (let i = 0; i < 3; i++) list.push(create(i));
for (const each of list) setLabel(each, parsed);
let sum = 0;
for (const each of list) sum += each.kept;
console.log(sum);
