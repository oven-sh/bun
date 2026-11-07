// Computed member names run in order: compiled answers as plain.
const log = [];
const k = n => (log.push(n), n);
class A {
  [k("a")]() {}
  static [k("b")] = log.push("init-b");
  [k("c")] = log.push("init-c");
  get [k("d")]() {
    return 1;
  }
}
new A();
console.log(log.join());
