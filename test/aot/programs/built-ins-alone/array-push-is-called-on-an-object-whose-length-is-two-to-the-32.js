const holder = { 0: 42, length: 2 ** 32 };
Array.prototype.push.call(holder, 10);
console.log(holder[0], holder.length, holder[2 ** 32]);
