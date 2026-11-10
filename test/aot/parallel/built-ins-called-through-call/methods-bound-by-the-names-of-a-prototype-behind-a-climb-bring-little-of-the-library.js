// STATISTIC: ImageFunctionsEmitted <= 40
function start(made) {
  let up = Object.getPrototypeOf(made);
  while (up && up !== Made.prototype) up = Object.getPrototypeOf(up);
  const proto = Made.prototype;
  for (const key in proto) {
    if (!Object.prototype.hasOwnProperty.call(proto, key)) continue;
    if (!(key in made)) made[key] = proto[key].bind(made);
  }
}
function Made() {
  start(this);
}
console.log(typeof new Made());
