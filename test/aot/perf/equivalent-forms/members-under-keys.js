// One class whose members do the same work under keys of several kinds. ../equivalent-forms.test.ts holds each of them to the member under a plain name.
import { imported, importedText } from "./keys-of-another-module.js";

const which = process.argv[2] ?? "";
const rounds = Number(process.argv[3] ?? "64");

const created = Symbol("created");
const withoutDescription = Symbol();
const registered = Symbol.for("registered");
const text = "text";
const getter = Symbol("getter");
const pair = Symbol("pair");
const ofClass = Symbol("ofClass");
const field = Symbol("field");

class Counter {
  count = 0;
  [field] = 3;
  constructor(step) {
    this.step = step;
  }
  plain(by) {
    this.count = (this.count + by * this.step) | 0;
    return this.count;
  }
  [created](by) {
    this.count = (this.count + by * this.step) | 0;
    return this.count;
  }
  [withoutDescription](by) {
    this.count = (this.count + by * this.step) | 0;
    return this.count;
  }
  [registered](by) {
    this.count = (this.count + by * this.step) | 0;
    return this.count;
  }
  [Symbol.match](by) {
    this.count = (this.count + by * this.step) | 0;
    return this.count;
  }
  [text](by) {
    this.count = (this.count + by * this.step) | 0;
    return this.count;
  }
  [imported](by) {
    this.count = (this.count + by * this.step) | 0;
    return this.count;
  }
  [importedText](by) {
    this.count = (this.count + by * this.step) | 0;
    return this.count;
  }
  get plainGetter() {
    this.count = (this.count + this.step) | 0;
    return this.count;
  }
  get [getter]() {
    this.count = (this.count + this.step) | 0;
    return this.count;
  }
  get plainPair() {
    return this.count;
  }
  set plainPair(by) {
    this.count = (this.count + by * this.step) | 0;
  }
  get [pair]() {
    return this.count;
  }
  set [pair](by) {
    this.count = (this.count + by * this.step) | 0;
  }
  static total = 0;
  static plainOfClass(by) {
    Counter.total = (Counter.total + by) | 0;
    return Counter.total;
  }
  static [ofClass](by) {
    Counter.total = (Counter.total + by) | 0;
    return Counter.total;
  }
}

class Below extends Counter {
  plain(by) {
    return super.plain(by + 1);
  }
  [created](by) {
    return super[created](by + 1);
  }
}

const some = Symbol("some");
class Has {
  count = 0;
  plainSome(by) {
    this.count = (this.count + by) | 0;
    return this.count;
  }
  [some](by) {
    this.count = (this.count + by) | 0;
    return this.count;
  }
}
class Lacks {
  count = 0;
}
const mixed = [new Has(), new Lacks(), new Has()];

const counters = [new Counter(1), new Counter(2), new Below(3)];
const at = i => counters[i % 3 === 2 ? 2 : i & 1];
const own = i => counters[i & 1];

const loops = {
  "a method under a plain name": n => {
    let sum = 0;
    for (let i = 0; i < n; i++) sum = (sum + own(i).plain(i)) | 0;
    return sum;
  },
  "a method under a symbol that the module creates": n => {
    let sum = 0;
    for (let i = 0; i < n; i++) sum = (sum + own(i)[created](i)) | 0;
    return sum;
  },
  "a method under a symbol without a description": n => {
    let sum = 0;
    for (let i = 0; i < n; i++) sum = (sum + own(i)[withoutDescription](i)) | 0;
    return sum;
  },
  "a method under a registered symbol": n => {
    let sum = 0;
    for (let i = 0; i < n; i++) sum = (sum + own(i)[registered](i)) | 0;
    return sum;
  },
  "a method under a well-known symbol": n => {
    let sum = 0;
    for (let i = 0; i < n; i++) sum = (sum + own(i)[Symbol.match](i)) | 0;
    return sum;
  },
  "a method under a constant that holds a text": n => {
    let sum = 0;
    for (let i = 0; i < n; i++) sum = (sum + own(i)[text](i)) | 0;
    return sum;
  },
  "a method under a symbol of another module": n => {
    let sum = 0;
    for (let i = 0; i < n; i++) sum = (sum + own(i)[imported](i)) | 0;
    return sum;
  },
  "a method under a text of another module": n => {
    let sum = 0;
    for (let i = 0; i < n; i++) sum = (sum + own(i)[importedText](i)) | 0;
    return sum;
  },
  "a getter under a plain name": n => {
    let sum = 0;
    for (let i = 0; i < n; i++) sum = (sum + own(i).plainGetter) | 0;
    return sum;
  },
  "a getter under a symbol": n => {
    let sum = 0;
    for (let i = 0; i < n; i++) sum = (sum + own(i)[getter]) | 0;
    return sum;
  },
  "a getter and a setter under a plain name": n => {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      own(i).plainPair = i;
      sum = (sum + own(i).plainPair) | 0;
    }
    return sum;
  },
  "a getter and a setter under a symbol": n => {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      own(i)[pair] = i;
      sum = (sum + own(i)[pair]) | 0;
    }
    return sum;
  },
  "a static method under a plain name": n => {
    let sum = 0;
    for (let i = 0; i < n; i++) sum = (sum + Counter.plainOfClass(i)) | 0;
    return sum;
  },
  "a static method under a symbol": n => {
    let sum = 0;
    for (let i = 0; i < n; i++) sum = (sum + Counter[ofClass](i)) | 0;
    return sum;
  },
  "a method of two classes under a plain name": n => {
    let sum = 0;
    for (let i = 0; i < n; i++) sum = (sum + at(i).plain(i)) | 0;
    return sum;
  },
  "a method of two classes under a symbol": n => {
    let sum = 0;
    for (let i = 0; i < n; i++) sum = (sum + at(i)[created](i)) | 0;
    return sum;
  },
  "a method that some objects have, read under a plain name and called": n => {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const object = mixed[i % 3];
      const method = object.plainSome;
      if (method !== undefined) sum = (sum + method.call(object, i)) | 0;
    }
    return sum;
  },
  "a method that some objects have, read under a symbol and called": n => {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const object = mixed[i % 3];
      const method = object[some];
      if (method !== undefined) sum = (sum + method.call(object, i)) | 0;
    }
    return sum;
  },
  "a field under a plain name": n => {
    let sum = 0;
    for (let i = 0; i < n; i++) sum = (sum + own(i).step) | 0;
    return sum;
  },
  "a field under a symbol": n => {
    let sum = 0;
    for (let i = 0; i < n; i++) sum = (sum + own(i)[field]) | 0;
    return sum;
  },
};

if (which) console.log(which, loops[which](rounds));
else for (const name in loops) console.log(name, loops[name](rounds), loops[name](3));
