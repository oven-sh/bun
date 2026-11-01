function take() {
  const d = Reflect.getOwnPropertyDescriptor(process.env, "TZ");
  return { get: d.get };
}
console.log(typeof take().get);
