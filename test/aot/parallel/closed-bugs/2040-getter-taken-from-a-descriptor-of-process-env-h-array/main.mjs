function take() {
  const d = Object.getOwnPropertyDescriptor(process.env, "TZ");
  return [d.get, d.set];
}
console.log(take().map(each => typeof each).join());
