// The handler holds a text and a number, no function and no `get`, and is written in place: nothing of the library is in the executable.
// STATISTIC: ImageFunctionsEmitted <= 30
const below = Object.create(new Proxy({ seen: 1 }, { note: "no trap", count: 3 }));
console.log(below, below.seen, "seen" in below);
