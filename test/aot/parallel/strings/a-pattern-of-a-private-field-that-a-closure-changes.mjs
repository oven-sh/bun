// A closure that has taken the pattern of a private field may compile it anew or lock its lastIndex, and exec() and test() see that.
class Gate {
  #shape = /^(a+)$/;
  count(words) {
    let n = 0;
    for (const word of words) {
      const found = this.#shape.exec(String(word));
      if (found) n += found[1].length;
    }
    return n;
  }
  changer() {
    const shape = this.#shape;
    return text => {
      shape.compile(text);
    };
  }
}
const words = JSON.parse('["a","aa","b","bb","bbb"]');
const gate = new Gate();
const change = gate.changer();
let sum = 0;
for (let turn = 0; turn < 200; turn++) sum += gate.count(words);
change("^(b+)$");
for (let turn = 0; turn < 200; turn++) sum += gate.count(words);
console.log(sum);

class Steps {
  #next = /a/g;
  walk(text) {
    let n = 0;
    try {
      for (let k = 0; k < 3; k++) if (this.#next.test(text)) n += this.#next.lastIndex;
    } catch (error) {
      return error.name;
    }
    return n;
  }
  freezer() {
    const next = this.#next;
    return () => {
      Object.defineProperty(next, "lastIndex", { writable: false, value: 0 });
    };
  }
}
const steps = new Steps();
const freeze = steps.freezer();
for (let k = 0; k < 100; k++) steps.walk("banana");
freeze();
console.log(steps.walk("banana"));
