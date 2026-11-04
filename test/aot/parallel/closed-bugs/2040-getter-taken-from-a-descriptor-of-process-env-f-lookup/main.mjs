function take() {
  return { get: process.env.__lookupGetter__("TZ"), set: process.env.__lookupSetter__("TZ") };
}
console.log(typeof take().get, typeof take().set);
