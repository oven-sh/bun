function make(step: number) { let count = 0; class Counter { #add(n: number) { count += n * step; return count; } bump() { return this.#add(1); } static is(o: object) { return #add in o; } } return Counter; }
const C = make(3), c = new C(); console.log(c.bump(), c.bump(), C.is(c), C.is({}));
