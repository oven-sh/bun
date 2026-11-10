class Recent {
  constructor(room) {
    this.room = room;
    this.held = new Map();
  }
  get(key) {
    if (!this.held.has(key)) return undefined;
    const value = this.held.get(key);
    this.held.delete(key);
    this.held.set(key, value);
    return value;
  }
  set(key, value) {
    this.held.delete(key);
    this.held.set(key, value);
    if (this.held.size > this.room) this.held.delete(this.held.keys().next().value);
  }
}
const recent = new Recent(2);
recent.set("a", 1);
recent.set("b", 2);
recent.get("a");
recent.set("c", 3);
console.log([...recent.held.keys()].join(), recent.get("b"));
