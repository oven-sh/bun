// An arrow function that a derived constructor makes behind `super()` copies `this`, as in a base constructor: no environment is made, and the closure tests nothing
class Emitter {
  handlers: ((value: number) => void)[] = [];
  on(handler: (value: number) => void) { this.handlers.push(handler); }
  emit(value: number) { for (const handler of this.handlers) handler(value); }
}
class Listener extends Emitter {
  seen: number;
  last: number;
  constructor(start: number) {
    super();
    this.seen = start;
    this.last = 0;
    this.on(value => { this.seen += value; this.last = value; });
  }
}
let total = 0;
for (let i = 0; i < 3000; i++) {
  const listener = new Listener(i & 7);
  listener.emit(i & 3);
  listener.emit(1);
  total += listener.seen + listener.last;
}
console.log(total);
