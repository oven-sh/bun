function Mid() { this.more = 2; }
const mid = new Mid();
let said = "";
for (let turn = 0; turn < 3; turn++) {
    Object.defineProperty(Mid.prototype, "tell", { get() { return this.more + turn; }, configurable: true });
    said += mid.tell + ";";
}
console.log(said, new Mid().tell);
