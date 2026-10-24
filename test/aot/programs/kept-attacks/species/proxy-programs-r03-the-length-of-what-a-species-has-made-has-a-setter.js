// Species: proxy programs  the length of what a species has made has a setter. It prints what plain Bun prints.
const log = [];
class Odd { constructor(n) { log.push("made " + n); this.kept = "k"; } set length(v) { log.push("length=" + v + " on " + this.kept); this.seen = v; } get length() { return 99; } }
const source = [1, 2, 3]; source.constructor = { [Symbol.species]: Odd };
const sliced = source.slice(1), joined = source.concat([4]), flat = source.flat();
log.push(sliced.seen, sliced[0], sliced.length, joined.seen, joined[3], flat.seen, Object.keys(flat).join());
console.log(log.join("; "));
