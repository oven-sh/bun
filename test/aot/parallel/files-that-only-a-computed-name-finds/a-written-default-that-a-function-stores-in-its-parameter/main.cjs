function load(name) {
  name = name || "./conf.cjs";
  return require(name);
}
const conf = load(process.env.MADE_UP_CONF);
console.log(conf.name);
