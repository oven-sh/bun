// Bun forwards a `.call` site only where what it reads there is Function.prototype.call itself. Here it is apply, which finds by itself that its receiver is no function.
const holder = { call: Function.prototype.apply };
try {
  holder.call(null, [1]);
} catch (error) {
  console.log(error.name, error.message);
}
