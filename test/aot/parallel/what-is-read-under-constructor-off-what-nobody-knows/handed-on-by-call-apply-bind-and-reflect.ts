function use(kept: any): string {
  return String(kept("4"));
}
function ask(given: any): string {
  const kept = given.constructor;
  return use.call(null, kept) + use.apply(null, [kept]) + use.bind(null, kept)() + Reflect.apply(use, null, [kept]) + Function.prototype.call.call(use, null, kept);
}
console.log(ask(JSON.parse("0")));
