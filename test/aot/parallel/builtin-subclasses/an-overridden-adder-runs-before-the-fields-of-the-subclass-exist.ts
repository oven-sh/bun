const log: unknown[] = [];

class Counted<K, V> extends Map<K, V> {
  sets = 0;
  label: string = "counted";
  set(key: K, value: V) {
    log.push(this.sets, this.label, Object.hasOwn(this, "sets"));
    this.sets++;
    log.push(this.sets);
    return super.set(key, value);
  }
}
const counted = new Counted<string, number>([["p", 1]]);
counted.set("q", 2);
console.log(log.map(String).join(), counted.sets, counted.label, counted.size, Object.keys(counted).join());

class Tagged extends Set<number> {
  tags: string[] = [];
  add(value: number) {
    if (this.tags === undefined) log.push("early " + value);
    else this.tags.push("late " + value);
    return super.add(value);
  }
}
const tagged = new Tagged([1, 2]);
tagged.add(3);
console.log(log.slice(-2).join(), tagged.tags.join(), [...tagged].join());

class Frozen extends WeakSet<object> {
  #seen = 0;
  add(value: object) {
    try {
      this.#seen++;
    } catch (error) {
      log.push((error as Error).constructor.name);
    }
    return super.add(value);
  }
  get seen() {
    return this.#seen;
  }
}
const frozen = new Frozen([{}]);
frozen.add({});
console.log(log.at(-1), frozen.seen);
