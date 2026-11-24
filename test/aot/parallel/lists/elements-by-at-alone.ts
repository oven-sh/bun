// The only call of at() in the program lies outside loops, on a list that is as its class makes it.
function last(list: string[]): string | undefined { return list.at(-1); }
console.log(last(process.argv.slice(0, 1)) === process.argv[0], last([]), last(["a", "b"]));
