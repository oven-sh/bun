function print(a, b, c) { let s = "" + a; if (b !== undefined) s += " " + b; if (c !== undefined) s += " " + c; console.log(s); }
let calls = 0;
function thenable(value) { return { then(resolve) { calls++; resolve(value); } }; }
function rejecting(value) { return { then(resolve, reject) { calls++; reject(value); } }; }
function kind(v) { return typeof v === "object" ? (v === null ? "null" : "object " + Object.keys(v).join()) : typeof v + " " + String(v); }

async function main() {
  print("then", kind(await Promise.resolve(1).then(() => thenable("a"))), calls);
  print("catch", kind(await Promise.reject(1).catch(() => thenable("b"))), calls);
  print("finally keeps the value", kind(await Promise.resolve(1).finally(() => thenable("c"))), calls);
  try { await Promise.resolve(1).finally(() => rejecting("d")); } catch (e) { print("finally rejects", kind(e), calls); }
  print("try", kind(await Promise.try(() => thenable("e"))), calls);
  const w = Promise.withResolvers(); w.resolve(thenable("f")); print("withResolvers", kind(await w.promise), calls);
  print("fromAsync", kind((await Array.fromAsync([thenable("g")]))[0]), calls);
  print("fromAsync mapped", kind((await Array.fromAsync([1], () => thenable("h")))[0]), calls);
  async function* generator() { const got = yield thenable("i"); print("sent", kind(got), calls); return thenable("j"); }
  const it = generator();
  print("yield", kind((await it.next()).value), calls);
  print("return", kind((await it.next(thenable("not awaited"))).value), calls);
  const it2 = generator(); await it2.next();
  print("return()", kind((await it2.return(thenable("k"))).value), calls);
  print("resolve", kind(await Promise.resolve(thenable("l"))), calls);
  try { await Promise.reject(thenable("m")); } catch (e) { print("reject does not unwrap", kind(e), calls); }
  print("nested", kind(await thenable(thenable(thenable("n")))), calls);
  print("all", (await Promise.all([thenable("o"), 1, Promise.resolve(thenable("p"))])).map(kind).join("; "), calls);
  print("allSettled", (await Promise.allSettled([thenable("q"), rejecting("r")])).map(r => r.status + " " + kind(r.value ?? r.reason)).join("; "), calls);
  print("race", kind(await Promise.race([thenable("s")])), calls);
  print("any", kind(await Promise.any([rejecting("t"), thenable("u")])), calls);
  class Sub extends Promise {}
  print("subclass resolve", kind(await Sub.resolve(thenable("v"))), calls);
  print("subclass then", kind(await Sub.resolve(1).then(() => thenable("w"))), calls);
  const arrow = async () => thenable("x");
  print("async arrow", kind(await arrow()), calls);
  const method = { async m() { return thenable("y"); } };
  print("async method", kind(await method.m()), calls);
  for await (const v of [thenable("z")]) print("for await", kind(v), calls);
  const getter = { get then() { calls += 100; return resolve => resolve("getter"); } };
  print("then is a getter", kind(await getter), calls);
  const callable = Object.assign(function () {}, { then(resolve) { calls++; resolve("function"); } });
  print("a function with then", kind(await callable), calls);
  const notCallable = { then: 5 };
  print("then is a number", kind(await notCallable), calls);
}
main().catch(e => print("failed", String(e)));
