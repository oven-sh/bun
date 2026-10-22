const identity = structuredClone({}).constructor(Object);
const UnknownProxy = identity(Proxy);

function attempt(f) {
  try {
    return f();
  } catch (e) {
    return "threw " + e.constructor.name;
  }
}

{
  const target = { a: 1 };
  Object.freeze(new UnknownProxy(target, {}));
  console.log(attempt(() => { target.a = 7; return target.a; }), target.a);
}
{
  const target = { a: 1 };
  Object.freeze(UnknownProxy.revocable(target, {}).proxy);
  console.log(attempt(() => { target.a = 7; return target.a; }), target.a);
}
{
  const target = { a: 1 };
  Object.freeze(Reflect.construct(UnknownProxy, [target, {}]));
  console.log(attempt(() => { target.a = 7; return target.a; }), target.a);
}
{
  const target = { a: 1 };
  Object.seal(new UnknownProxy(target, {}));
  console.log(attempt(() => delete target.a), target.a, attempt(() => { target.z = 1; return target.z; }));
}
{
  const target = [1, 2, 3];
  Object.freeze(new UnknownProxy(target, {}));
  console.log(attempt(() => { target[0] = 7; return target[0]; }), attempt(() => target.push(4)), target.length);
}
