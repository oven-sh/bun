const proxy = new Proxy({}, { getPrototypeOf: 25 });
try {
  Object.getPrototypeOf(proxy);
  console.log("no error");
} catch (error) {
  console.log(error.constructor.name);
}
