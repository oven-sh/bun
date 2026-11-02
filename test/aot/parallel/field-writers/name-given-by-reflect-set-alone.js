// Reflect.set is all that gives the instances the name: it creates an ordinary property.
class Holder {
  constructor() {
    this.first = 1;
  }
}
function read(holder) {
  let sum = 0;
  for (let turn = 0; turn < 100; turn++) sum += holder.late ?? -1;
  return sum;
}
const holders = [];
for (let index = 0; index < 4; index++) {
  const holder = new Holder();
  if (index & 1) console.log(Reflect.set(holder, "late", index));
  holders.push(holder);
}
for (const holder of holders) console.log(read(holder), holder.late, Object.keys(holder).join(), JSON.stringify(Object.getOwnPropertyDescriptor(holder, "late")), JSON.stringify(holder));
holders[1].late = 7;
delete holders[3].late;
for (const holder of holders) console.log(read(holder), "late" in holder, JSON.stringify({ ...holder }));
