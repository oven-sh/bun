function take() {
  const d = Object.getOwnPropertyDescriptor(process.env, "TZ");
  return { get: d.get };
}
console.log(typeof take().get);
