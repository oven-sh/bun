// The names of the doors come from outside, so nothing is copied in line and the list is out of sight where it is spliced.
// COUNT: operation:operationAOTArraySpliceGeneric <= 12
// COUNT: operation:operationAOTArraySpliceItemGeneric <= 8
const [OUT, INTO] = JSON.parse('["out","into"]');
const roomy = (...items) => { const list = Array.from(items); list.push(items[0]); list.pop(); return list; };
const reads = { out(list, at) { return list.splice(at, 1); }, into(list, at, item) { return list.splice(at, 0, item); }, first(list, at) { return list.splice(at, 1)[0]; }, taken(list, at) { const [item] = list.splice(at, 1); return item; } };
const ask = (door, ...rest) => reads[door](...rest);
let last;
for (let turn = 0; turn < 4; turn++)
  for (const door of JSON.parse(JSON.stringify(Object.keys(reads))))
    for (const make of [() => roomy({ n: 1 }, { n: 2 }, { n: 3 }), () => roomy(1, 2, 3), () => roomy("a", "b", "c"), () => [1, "b", { n: 3 }], () => Array.from([0.5, 1.5, 2.5])]) {
      const list = make();
      const answer = ask(door, list, 1, 9);
      console.log("SAID", door, JSON.stringify(answer), Array.isArray(answer), JSON.stringify(list), answer === last, answer === list);
      if (Array.isArray(answer)) {
        console.log("SAID", answer.length, Object.getPrototypeOf(answer) === Array.prototype, Object.keys(answer).join());
        answer.push("more", 1.5, { more: turn });
        answer.note = "kept";
        console.log("SAID", JSON.stringify(answer), answer.length, answer.note, JSON.stringify(list));
      }
      last = answer;
    }
