// Exports of start-up modules and thrown values: the process hands the "uncaughtException" listener whatever was thrown, here a number, a string and undefined, while the listener is typed for the program's own error class.
class Failure extends Error {
  code = 7;
}

let total = 0;

function onFailure(error: Failure, origin: string): void {
  total += error instanceof Failure ? error.code : typeof error === "number" ? 100 + error : typeof error === "string" ? 1000 + (error as string).length : error === undefined ? 10000 : 100000;
  total += origin === "uncaughtException" ? 1000000 : origin === "unhandledRejection" ? 10000000 : 0;
}

onFailure(new Failure("mine"), "own call");
process.on("uncaughtException", onFailure);
setTimeout(() => { throw 42; }, 1);
setTimeout(() => { throw "text"; }, 2);
setTimeout(() => { throw undefined; }, 3);
setTimeout(() => { throw new Failure("thrown"); }, 4);
setTimeout(() => console.log(total), 50);
