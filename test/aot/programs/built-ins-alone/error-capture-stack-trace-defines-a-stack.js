const holder = { stack: 0 };
Error.captureStackTrace(holder);
console.log(typeof holder.stack, holder.stack.length > 0);
