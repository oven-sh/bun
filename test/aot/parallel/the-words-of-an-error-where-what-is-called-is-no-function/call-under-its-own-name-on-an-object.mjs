// Bun compiles `holder.call(..)` to a call of `holder`, so here the message quotes the site.
const holder = { call: Function.prototype.call };
try {
  holder.call(null, 1);
} catch (error) {
  console.log(error.name, error.message);
}
