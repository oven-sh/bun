// The untyped twin: a name that is stored late and never with undefined, asked for before its first store: `if (!this.cache) this.cache = make()`.
function Holder(id) {
  this.id = id;
}
Holder.prototype.cacheOf = function () {
  if (!this.cache) this.cache = { made: this.id };
  return this.cache;
};
Holder.prototype.countOf = function () {
  if (this.count === undefined) this.count = 0;
  return ++this.count;
};
function peek(holder) {
  return holder.cache ? holder.cache.made : "none";
}
function peekCount(holder) {
  return holder.count;
}

let sum = 0;
const holders = [];
for (let index = 0; index < 3000; index++) {
  const holder = new Holder(index);
  holders.push(holder);
  if (peek(holder) !== "none" || peekCount(holder) !== undefined) throw new Error("found something in a new object");
  if (index % 3) sum += holder.cacheOf().made + holder.countOf() + holder.countOf();
}
for (const holder of holders) sum += (peek(holder) === "none" ? 1 : 2) + (peekCount(holder) ?? 5);
console.log(sum);

const one = holders[1];
delete one.cache;
delete one.count;
console.log(peek(one), peekCount(one), one.cacheOf().made, one.countOf(), Object.keys(one).join());
Holder.prototype.count = 100;
Holder.prototype.cache = { made: "above" };
console.log(peek(holders[0]), peekCount(holders[0]), holders[0].countOf(), peekCount(holders[0]), peek(holders[1]), holders[3].cacheOf().made);
delete Holder.prototype.count;
delete Holder.prototype.cache;
console.log(peek(holders[3]), peekCount(holders[3]), peekCount(holders[0]));
