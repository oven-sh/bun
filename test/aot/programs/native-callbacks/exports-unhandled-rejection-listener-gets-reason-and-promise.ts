// Exports of start-up modules and thrown values: the process calls the "unhandledRejection" listener with any reason and the promise, while the program's own call passes its error class and null.
class Failure extends Error {
  code = 7;
}

let total = 0;

function onRejection(reason: Failure, promise: Promise<number> | null): void {
  total += reason instanceof Failure ? reason.code : reason === null ? 100 : typeof reason === "object" ? 1000 : typeof reason === "bigint" ? 10000 : 100000;
  total += promise instanceof Promise ? 1000000 : 0;
}

onRejection(new Failure("mine"), null);
process.on("unhandledRejection", onRejection);
Promise.reject(null);
Promise.reject({ plain: true });
Promise.reject(5n);
Promise.reject(new Failure("rejected"));
(async () => JSON.parse("{"))();
setTimeout(() => console.log(total), 20);
