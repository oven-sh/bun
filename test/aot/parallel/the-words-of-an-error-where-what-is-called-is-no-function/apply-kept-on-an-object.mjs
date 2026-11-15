const holder = { kept: Function.prototype.apply };
try {
  holder.kept(null, [1]);
} catch (error) {
  console.log(error.name, error.message);
}
