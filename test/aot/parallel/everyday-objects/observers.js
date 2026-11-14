// Observers that are added, called, removed while they are called
class Subject {
  #observers = [];
  #value;
  constructor(value) {
    this.#value = value;
  }
  watch(call) {
    this.#observers.push(call);
    return () => (this.#observers = this.#observers.filter(other => other !== call));
  }
  set value(next) {
    const old = this.#value;
    this.#value = next;
    if (old !== next) for (const call of this.#observers) call(next, old);
  }
  get value() {
    return this.#value;
  }
}
function run(values) {
  const subject = new Subject(values[0]);
  const log = [];
  subject.watch((next, old) => log.push(next - old));
  const stop = subject.watch(next => (log.push("s" + next), next > 5 && stop()));
  for (const value of values) subject.value = value;
  subject.value++;
  return log.join() + " " + subject.value;
}
console.log(run([1, 2, 2, 6]));
console.log(run([10, 0]));
console.log(run([3]));
