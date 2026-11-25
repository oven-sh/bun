// A function declared beside `do { .. } while (0)` is one function object for all turns of the loops in it.

class Bell {
  constructor(name) {
    this.name = name;
    this.heard = [];
  }
  on(listener) {
    this.heard.push(listener);
  }
  off(listener) {
    const at = this.heard.indexOf(listener);
    if (at >= 0) this.heard.splice(at, 1);
    return this.heard.length;
  }
  ring() {
    for (const listener of this.heard) listener(this.name);
  }
}

function hang(bells, silent) {
  const log = [];
  function listen(name) {
    log.push(name);
  }
  do {
    if (silent) break;
    for (const bell of bells) bell.on(listen);
  } while (0);
  for (const bell of bells) bell.ring();
  const left = [];
  for (const bell of bells) left.push(bell.off(listen));
  for (const bell of bells) bell.ring();
  return `${log.join()} | ${left.join()}`;
}
console.log(hang([new Bell("a"), new Bell("b"), new Bell("c")], false), hang([new Bell("d")], true));

function countKinds(kinds, limit) {
  const seen = new Map();
  let turns = 0;
  function other() {
    return turns;
  }
  function kindOf(value, base = limit) {
    return value % base;
  }
  walk: do {
    for (const kind in kinds) {
      turns++;
      seen.set(kindOf, (seen.get(kindOf) ?? 0) + kinds[kind]);
      for (let step = limit; step > 0; step--) {
        if (seen.size > 2) break walk;
        seen.set(step % 2 ? kindOf : other, step);
      }
    }
    let rest = limit;
    do {
      seen.set(other, rest);
    } while (--rest > 0);
  } while (!1);
  return [...seen].map(([key, value]) => `${key.name}=${value}`).join() + ` ${other()} ${kindOf(7)}`;
}
console.log(countKinds({ x: 3, y: 4 }, 3), countKinds({}, 2));

function once(first) {
  let changes = 0;
  let previous = null;
  function mark() {
    return first;
  }
  if (first > 2) {
    if (mark !== previous) changes++;
    previous = mark;
  }
  do {
    let turn = 0;
    while (turn++ < 4) {
      if (mark !== previous) changes++;
      previous = mark;
      if (turn === 3) continue;
    }
    switch (first) {
      case 1:
        break;
      default:
        for (const value of [1, 2]) if (mark !== previous) changes += value * 10;
    }
  } while (null);
  return changes;
}
console.log(once(1), once(2), once(3));

function inBlocks(list) {
  const made = [];
  for (const item of list) {
    const own = new Set();
    function tell() {
      return item;
    }
    do {
      do {
        for (let turn = 0; turn < 3; turn++) own.add(tell);
      } while (false);
      for (const it of list) own.add(tell);
    } while (0);
    made.push(own.size, [...own].map(it => it()).join("+"));
  }
  return made.join();
}
console.log(inBlocks(["p", "q"]));

function Item(id) {
  this.id = id;
}
function makers(count) {
  const all = [];
  function Part(id) {
    Item.call(this, id);
  }
  do {
    for (let id = 0; id < count; id++) {
      if (id === 1) Part.prototype.say = function () {
        return "part " + this.id;
      };
      all.push(new Part(id));
    }
  } while (0);
  return all.map(part => part.say()).join() + " " + (all[0].constructor === all[count - 1].constructor);
}
console.log(makers(3));

function handlers(count) {
  const seen = new Set();
  function keep() {
    return count;
  }
  do {
    try {
      for (let turn = 0; turn < count; turn++) {
        seen.add(keep);
        if (turn === 2) throw new Error("stop");
      }
    } catch {
      for (let turn = 0; turn < 2; turn++) seen.add(keep);
    } finally {
      for (let turn = 0; turn < 2; turn++) seen.add(keep);
    }
  } while (0);
  seen.add(keep);
  return seen.size;
}
console.log(handlers(1), handlers(5));

function* steps(count) {
  function step() {
    return count;
  }
  do {
    for (let turn = 0; turn < count; turn++) yield step;
  } while (0);
  yield step;
}
console.log(new Set(steps(3)).size);

async function waits(count) {
  const seen = new Set();
  async function wait() {
    return count;
  }
  do {
    for (let turn = 0; turn < count; turn++) {
      await turn;
      seen.add(wait);
    }
    for await (const value of [1, 2]) seen.add(wait);
  } while (0);
  return seen.size;
}
console.log(await waits(3));
