// An async function and a generator whose bodies lean on their written parameters over many suspensions get an object of another class with the same members, a Proxy, and null.
const log: string[] = [];
class Box {
  x = 1;
  y = 2;
}
class Impostor {
  get x() {
    log.push("getter x");
    return 10;
  }
  y = 20;
}
async function sum(box: Box, n: number) {
  let s = 0;
  for (let i = 0; i < n; i++) {
    s += box.x + box.y;
    await null;
    s += box.y;
  }
  return s;
}
function* walk(box: Box, n: number) {
  for (let i = 0; i < n; i++) {
    yield box.x + box.y;
    yield box.y * i;
  }
}
async function deed(box: unknown, n: unknown) {
  let text: string;
  try {
    text = String(await sum(box as Box, n as number));
  } catch (e) {
    text = (e as Error).name;
  }
  try {
    return text + " " + [...walk(box as Box, n as number)].join();
  } catch (e) {
    return text + " " + (e as Error).name;
  }
}
const proxy = new Proxy(new Box(), { get: (target, key) => (log.push("trap " + String(key)), Reflect.get(target, key)) });
console.log(await deed(new Box(), 2));
console.log(await deed(new Impostor(), 2));
console.log(await deed(proxy, 1));
console.log(await deed(null, 1));
console.log(await deed(null, 0));
console.log(await deed(new Box(), "2"));
for (let i = 0; i < 4; i++) console.log(await deed(i % 2 ? new Box() : new Impostor(), i));
console.log(log.join(" | "));
