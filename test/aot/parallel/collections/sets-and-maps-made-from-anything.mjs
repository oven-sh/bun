// new Set(x) and new Map(x) are one call of an operation, which hands whatever it cannot list without an iterator to the constructor itself.
function setOf(x) { try { const s = new Set(x); return [s.size, [...s].join("/")].join(":"); } catch (error) { return error.name + ": " + error.message; } }
function mapOf(x) { try { const m = new Map(x); return [m.size, [...m].map(p => p.join("=")).join("/")].join(":"); } catch (error) { return error.name + ": " + error.message; } }
function* walk() { yield 1; yield 2; yield 1; }
const holey = [1, , 3];
const own = [1, 2]; own[Symbol.iterator] = function* () { yield 9; };
console.log([setOf(), setOf(null), setOf(undefined), setOf([]), setOf(["a", "b", "a"]), setOf([1, 2, 1, 1.5, NaN, NaN, 0, -0]), setOf("hello"), setOf(walk()), setOf(new Set([3, 4])), setOf(new Map([[1, 2]])), setOf(holey), setOf(own), setOf(5), setOf({}), setOf([{}, {}].map((o, i) => i))].join(" | "));
console.log([mapOf(), mapOf(null), mapOf([]), mapOf([["a", 1], ["b", 2], ["a", 3]]), mapOf([[1, 2], [1.5, 3]]), mapOf(new Map([[1, 2]])), mapOf([1]), mapOf([[1]]), mapOf("ab"), mapOf(5), mapOf([{ 0: "k", 1: "v" }]), mapOf(Object.entries({ x: 1, y: 2 }))].join(" | "));
class Mine extends Set { constructor(x) { super(x); this.mine = true; } }
console.log(new Mine([1, 2]).size, new Mine([1]).mine);
