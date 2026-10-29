// Each holder has an arrow function over itself in a field. A function whose parameter takes any object stores the arrow function of one holder into the field of another, and a call through that field answers for the holder it was made over.
class Other {
  get: () => number = () => 0;
}
class Holder {
  kept: number;
  get = () => this.kept;
  constructor(kept: number) {
    this.kept = kept;
  }
}
class Source {
  from: Holder;
  constructor(from: Holder) {
    this.from = from;
  }
}
function copy(target: Other, source: Source) {
  target.get = source.from.get;
}
const first = new Holder(1);
const second = new Holder(2);
copy(new Other(), new Source(second));
copy(JSON.parse("{}"), new Source(second));
copy(first as any, JSON.parse("[]").length ? (null as any) : { from: second });
console.log(first.get(), second.get());
