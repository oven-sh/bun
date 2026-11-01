function take(name) {
  const d = Object.getOwnPropertyDescriptor(process.env, name);
  return { get: d.get, set: d.set };
}
console.log(typeof take("NODE_TLS_REJECT_UNAUTHORIZED").get);
