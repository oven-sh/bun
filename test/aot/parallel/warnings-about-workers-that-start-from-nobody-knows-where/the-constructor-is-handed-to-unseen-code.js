// Build prints: 1 x warn: TS100082: The build can't tell which file this Worker starts from. If that file isn't an entry point, the Worker fails to load
const unseen = (0, eval)("(x) => typeof x");
console.log(unseen(Worker));
