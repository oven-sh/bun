// A method that a built-in calls to convert an object writes the object's fields.
class Note {
  constructor(text) {
    this.text = text;
    this.times = 0;
  }
  toString() {
    this.times++;
    return this.text;
  }
}

class Weight {
  constructor(grams) {
    this.grams = grams;
    this.asked = 0;
  }
  valueOf() {
    this.asked += 1;
    return this.grams;
  }
}

class Either {
  constructor(first, second) {
    this.first = first;
    this.second = second;
    this.hints = "";
  }
  [Symbol.toPrimitive](hint) {
    this.hints += hint[0];
    return hint === "string" ? this.second : this.first;
  }
}

class Row {
  constructor(id) {
    this.id = id;
    this.written = 0;
  }
  toJSON() {
    this.written++;
    return { id: this.id };
  }
}

function show(note) {
  const before = note.times;
  const text = String(note);
  return text + " " + before + " " + note.times;
}

function weigh(weight, most) {
  let sum = 0;
  for (let turn = 0; turn < most; turn++) {
    for (let side = 0; side < 2; side++) {
      if (turn === 1 && side === 1) sum += Math.max(weight, 1);
    }
  }
  return sum + " " + weight.grams + " " + weight.asked;
}

function caught(weight) {
  for (let turn = 0; turn < 3; turn++) {
    try {
      if (turn === 1) throw new Error("x");
    } catch {
      Number(weight);
    } finally {
      BigInt(weight);
    }
  }
  return weight.asked;
}

function hinted(either) {
  const number = Math.trunc(either);
  const text = String(either);
  return number + text + either.hints + either.first + either.second;
}

function written(row) {
  const text = JSON.stringify(row);
  return text + JSON.stringify(row) + row.written;
}

function applied(weight) {
  const first = Reflect.apply(weight.valueOf, weight, []);
  return first + " " + Reflect.apply(Math.max, undefined, [weight, 2]) + " " + weight.asked + " " + weight.grams;
}

console.log(show(new Note("hello")));
console.log(weigh(new Weight(12), 3));
console.log(caught(new Weight(7)));
console.log(hinted(new Either(4.75, "four")));
console.log(written(new Row(3)));
console.log(applied(new Weight(5)));
const kept = new Note("kept");
console.log(show(kept), kept.times, show(kept), kept.times);
