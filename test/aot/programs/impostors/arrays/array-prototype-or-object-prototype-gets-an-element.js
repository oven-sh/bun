const observers = {
  read: list => list[1],
  readInALoop(list) {
    let found;
    for (let i = 0; i < list.length; i++) if (i === 1) found = list[i];
    return found;
  },
  has: list => (1 in list ? "inherited" : undefined),
  forOf(list) {
    let index = 0;
    for (const value of list) if (index++ === 1) return value;
  },
  spread: list => [...list][1],
  pattern(list) {
    const [, second] = list;
    return second;
  },
  patternWithADefault(list) {
    const [, second = undefined] = list;
    return second;
  },
  forEach(list) {
    let found;
    list.forEach((value, index) => {
      if (index === 1) found = value;
    });
    return found;
  },
  map: list => list.map(value => value)[1],
  filter: list => (list.filter(() => true).length === 3 ? "inherited" : undefined),
  reduce: list => list.reduce((found, value, index) => (index === 1 ? value : found), undefined),
  includes: list => (list.includes("inherited") ? "inherited" : undefined),
  indexOf: list => (list.indexOf("inherited") === 1 ? "inherited" : undefined),
  join: list => (list.join() === "a,inherited,c" ? "inherited" : undefined),
  slice: list => list.slice()[1],
  concat: list => [].concat(list)[1],
  from: list => Array.from(list)[1],
  at: list => list.at(1),
  find: list => list.find((value, index) => index === 1),
  json: list => (JSON.stringify(list) === '["a","inherited","c"]' ? "inherited" : undefined),
  apply: list => ((a, b) => b).apply(null, list),
  pastTheEnd: list => ["only"][1],
  freshHoles: () => new Array(3)[1],
  holeOfALocal() {
    const local = ["a", , "c"];
    return local[1];
  },
  popped(list) {
    list.length = 2;
    return list.pop();
  },
  reflected: list => Reflect.get(list, 1),
};

const changes = {
  "Array.prototype[1] is stored to": [Array.prototype, holder => { holder[1] = "inherited"; }],
  "Array.prototype[1] is set by Reflect": [Array.prototype, holder => Reflect.set(holder, 1, "inherited")],
  "Array.prototype[1] is defined": [Array.prototype, holder => { Object.defineProperty(holder, 1, { value: "inherited", configurable: true, writable: true }); }],
  "Array.prototype[1] becomes a getter": [Array.prototype, holder => { Object.defineProperty(holder, "1", { get: () => "inherited", configurable: true }); }],
  "two values are pushed onto Array.prototype": [Array.prototype, holder => { Array.prototype.push.call(holder, "zero", "inherited"); }],
  "Object.prototype[1] is stored to": [Object.prototype, holder => { holder[1] = "inherited"; }],
  "Object.prototype[1] is set by Reflect": [Object.prototype, holder => Reflect.set(holder, "1", "inherited")],
  "Object.prototype[1] is defined": [Object.prototype, holder => { Object.defineProperty(holder, 1, { value: "inherited", configurable: true, writable: true }); }],
  "Object.prototype[1] is assigned": [Object.prototype, holder => { Object.assign(holder, { 1: "inherited" }); }],
};

for (const name in observers) for (let i = 0; i < 1000; i++) observers[name](["a", "b", "c"]);
for (const name in observers) for (let i = 0; i < 1000; i++) observers[name](["a", , "c"]);

function observe() {
  const answers = {};
  for (const name in observers) {
    try {
      answers[name] = observers[name](["a", , "c"]);
    } catch (error) {
      answers[name] = "threw";
    }
  }
  return answers;
}

for (const label in changes) {
  const [holder, change] = changes[label];
  try {
    change(holder);
  } catch {}
  const during = observe();
  try {
    delete holder[0];
    delete holder[1];
    if (holder === Array.prototype) holder.length = 0;
  } catch {}
  const after = observe();
  for (const name in observers) {
    const isRight = during[name] === during.reflected && after[name] === undefined;
    console.log((isRight ? "ok " : "WRONG ") + label + ", " + name + (isRight ? ": the hole reads what Reflect.get reads, and nothing afterwards" : ": " + during[name] + " where Reflect.get saw " + during.reflected + ", afterwards " + after[name]));
  }
}
