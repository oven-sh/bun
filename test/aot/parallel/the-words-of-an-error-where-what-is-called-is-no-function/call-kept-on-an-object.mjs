// `kept` is a function: Function.prototype.call. What is no function is the receiver, and the message says so.
const holder = { kept: Function.prototype.call };
try {
  holder.kept(null, 1);
} catch (error) {
  console.log(error.name, error.message);
}
