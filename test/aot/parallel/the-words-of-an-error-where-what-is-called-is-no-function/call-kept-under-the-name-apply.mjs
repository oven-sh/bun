const holder = { apply: Function.prototype.call };
try {
  holder.apply(null, 1);
} catch (error) {
  console.log(error.name, error.message);
}
