// Plain arrays only call the callback they are given. A few other receivers keep it and call it again after the caller has returned, so the callback and its captured variables must outlive the call there.
const opened = new Function("value", "return value");
const kept = [];

class Keeping extends Array {
  forEach(callback) { kept.push(callback); super.forEach(callback); }
  map(callback) { kept.push(callback); return super.map(callback); }
  filter(callback) { kept.push(callback); return super.filter(callback); }
}
const collection = {
  items: [7, 8],
  forEach(callback) { kept.push(callback); for (const item of this.items) callback(item); },
  map(callback) { kept.push(callback); return [callback(this.items[0]), callback(this.items[1])]; },
  filter(callback) { kept.push(callback); return callback(this.items[0]) ? [this.items[0]] : []; },
};

class Emitter {
  listeners = [];
  on(listener) { this.listeners.push(listener); }
  off(listener) {
    const index = this.listeners.indexOf(listener);
    if (index < 0) return false;
    this.listeners.splice(index, 1);
    return true;
  }
  emit(value) { for (const listener of this.listeners.slice()) listener(value); }
}
const immediate = { on(listener) { listener(1); }, off() { return false; }, emit() {} };

function summed(list) {
  let sum = 0;
  list.forEach(value => (sum += value));
  sum += 1000;
  return sum;
}
function scaled(list, factor) {
  return list.map(value => value * factor).join();
}
function above(list, limit) {
  let rejected = 0;
  const passed = list.filter(value => value > limit || (rejected++, false));
  return passed.join() + "/" + rejected;
}
function stopped(list, limit) {
  let seen = 0;
  try {
    list.forEach(value => {
      if (value > limit) throw new RangeError("over " + value);
      return (seen += value);
    });
  } catch (error) {
    return error.name + ": " + error.message + " after " + seen;
  }
  return "all " + seen;
}
function subscribed(target) {
  let heard = 0;
  const listener = value => (heard += value);
  target.on(listener);
  target.emit(10);
  const removed = target.off(listener);
  target.emit(100);
  return heard + ":" + removed;
}
function rounds(lists) {
  let out = "";
  for (let round = 0; round < lists.length; round++) {
    let count = round * 100;
    lists[round].forEach(value => (count += value));
    count++;
    out += count + ";";
  }
  return out;
}

function again(from) {
  Bun.gc(true);
  const results = [];
  for (let index = from; index < kept.length; index++) {
    try {
      results.push(String(kept[index](1)));
    } catch (error) {
      results.push(error.name);
    }
  }
  return results.join() + " (" + new Set(kept.slice(from)).size + " of " + (kept.length - from) + ")";
}

const plain = [1, 2, 3];
const switching = [1, 5, 9];
const emitter = new Emitter();
const lines = [];
for (let turn = 0; turn < 600; turn++) {
  const rare = turn % 149 === 7 ? Keeping.from([4, 5]) : turn % 149 === 80 ? collection : null;
  const list = opened(rare ?? plain);
  if (turn === 300) switching.filter = function (callback) { kept.push(callback); return Array.prototype.filter.call(this, callback); };
  const line = [
    summed(list),
    scaled(list, turn & 3),
    above(list, 2),
    above(opened(switching), 4),
    stopped(list, turn % 5 === 0 ? 2 : 50),
    subscribed(opened(turn % 101 === 3 ? emitter : immediate)),
    rounds(opened(rare ? [plain, rare, plain, rare] : [plain, plain])),
  ].join(" | ");
  if (rare || turn % 101 === 3 || turn === 0 || turn === 299 || turn === 300 || turn === 599) lines.push(turn + ": " + line);
}
console.log(lines.join("\n"));
console.log("listeners left", emitter.listeners.length);
console.log("kept", kept.length);
console.log("called again", again(0));
console.log("and once more", again(kept.length - 20));
