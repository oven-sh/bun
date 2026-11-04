// The same with written types: the handler is a ProxyHandler that leaves both traps out, and gets one later.
type Size = { width: number; height: number };
class Box implements Size { width: number = 1; height: number = 2; }
function makeSize(): Size { return { width: 1, height: 2 }; }
function fill(size: Size, count: number): void { for (let i = 0; i < count; i++) size.width = i; }
function run(what: string, target: Size): void {
  let defined = 0, stores = 0;
  const handler: ProxyHandler<Size> = { set(target, key, value, receiver) { stores++; return Reflect.set(target, key, value, receiver); } };
  const proxy = new Proxy(target, handler), told: number[] = [];
  fill(proxy, 300); told.push(stores, defined);
  handler.defineProperty = (target, key, descriptor) => { defined++; return Reflect.defineProperty(target, key, descriptor); };
  fill(proxy, 100); told.push(stores, defined);
  delete handler.defineProperty;
  fill(proxy, 50); told.push(stores, defined);
  console.log(what, told.join(" "), target.width);
}
run("a record", makeSize());
run("an instance", new Box());
run("an ordinary object", JSON.parse('{"width":1,"height":2}'));
