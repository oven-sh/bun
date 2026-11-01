// Flags: --aot-validate
const source = new String("abc");
const r = Object.defineProperties({}, Object.getOwnPropertyDescriptors(source));
for (const key of Reflect.ownKeys(r)) {
  const kept = { value: r[key] };
  console.log(String(key), kept.value, [r[key]][0], typeof r[key]);
}
