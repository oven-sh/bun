function take() {
  const all = Object.getOwnPropertyDescriptors(process.env);
  return { get: all.TZ.get };
}
console.log(typeof take().get);
