const key = Symbol[process.argv.length > 99 ? "iterator" : "asyncDispose"];
class Handle { [Symbol.asyncDispose]() { return 5; } idle() { return 6; } }
console.log(new Handle()[key]());
