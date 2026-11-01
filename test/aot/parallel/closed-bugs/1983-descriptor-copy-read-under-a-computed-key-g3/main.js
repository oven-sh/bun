// Flags: --aot-validate
// Exit code: 1
const source = (function () { return arguments; })(1, 2);
const r = Object.defineProperties({}, Object.getOwnPropertyDescriptors(source));
for (const key of Reflect.ownKeys(r)) {
  const kept = { value: r[key] };
  console.log(String(key), typeof kept.value, typeof [r[key]][0]);
}
console.log({ callee: r.callee }.callee === source.callee, { length: r.length }.length);
