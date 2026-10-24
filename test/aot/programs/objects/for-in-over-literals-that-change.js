// for-in loops over literals whose names the compiler knows, while callbacks delete, add, redefine and reorder what the loop walks: each loop lists what the language says, whatever it was compiled to.
const print = console.log;
const makeTriple = v => ({ first: v, second: v, third: v });
const makeReversed = v => ({ third: v, second: v, first: v });
function walk(object, note) {
  for (const key in object) note(key, object);
}
function copy(target, source) {
  for (const key in source) target[key] = source[key];
  return target;
}
function firstKey(object) {
  for (const key in object) return key;
  return "none";
}
const set = (object, key, value) => {
  object[key] = value;
  return object;
};
const remove = (object, key) => {
  delete object[key];
  return object;
};
const setPrototype = (object, prototype) => Object.setPrototypeOf(object, prototype);

const show = (what, object, change) => {
    let seen = "";
    try {
        walk(object, (key, walked) => {
            seen += " " + key + "=" + walked[key];
            change(key, walked);
        });
    } catch (error) {
        seen += " threw " + error;
    }
    print(what + ":" + seen);
};
const nothing = () => { };
for (let round = 0; round < 3; round++) {
    show("unchanged", makeTriple(round), nothing);
    show("other order", makeReversed(round), nothing);
}
show("next name deleted", makeTriple(1), (key, walked) => { if (key === "first") remove(walked, "second"); });
show("last name deleted", makeTriple(1), (key, walked) => { if (key === "first") remove(walked, "third"); });
show("own name deleted", makeTriple(1), (key, walked) => { remove(walked, key); });
show("all deleted at once", makeTriple(1), (key, walked) => { remove(walked, "first"); remove(walked, "second"); remove(walked, "third"); });
show("deleted and stored again", makeTriple(1), (key, walked) => { if (key === "first") { remove(walked, "second"); set(walked, "second", 9); } });
show("name added", makeTriple(1), (key, walked) => { if (key === "first") set(walked, "fourth", 4); });
show("index added", makeTriple(1), (key, walked) => { if (key === "second") set(walked, "5", 5); });
show("value stored", makeTriple(1), (key, walked) => { set(walked, "third", key); });
show("value of another kind stored", makeTriple(1), (key, walked) => { if (key === "first") set(walked, "second", { toString() { return "object"; } }); });
show("many names added", makeTriple(1), (key, walked) => { if (key === "first") for (let i = 0; i < 200; i++) set(walked, "name" + i, i); });
show("prototype changed", makeTriple(1), (key, walked) => { if (key === "first") setPrototype(walked, { inherited: 7 }); });
show("prototype set before", setPrototype(makeTriple(1), { inherited: 7, second: 8 }), nothing);
show("no prototype", setPrototype(makeTriple(1), null), nothing);
show("made an accessor", makeTriple(1), (key, walked) => { if (key === "first") Object.defineProperty(walked, "second", { get() { return "got"; }, enumerable: true, configurable: true }); });
show("hidden", makeTriple(1), (key, walked) => { if (key === "first") Object.defineProperty(walked, "second", { enumerable: false }); });
show("frozen", makeTriple(1), (key, walked) => { Object.freeze(walked); });
show("callback throws", makeTriple(1), key => { if (key === "second") throw "stop"; });
show("extra name before", set(makeTriple(1), "fourth", 4), nothing);
show("one name missing before", remove(makeTriple(1), "second"), nothing);
show("ordinary object", { first: 1, second: 2, third: 3 }, nothing);
show("array", [1, 2], nothing);
show("string", "ab", nothing);
show("null", null, nothing);
show("undefined", undefined, nothing);
show("number", 5, nothing);

const list = object => { let text = ""; for (const key in object) text += " " + key + "=" + object[key]; return text; };
print("copy:" + list(copy({}, makeTriple(2))));
print("copy of the other order:" + list(copy({}, makeReversed(2))));
print("copy into itself:" + list((triple => copy(triple, triple))(makeTriple(3))));
print("copy into a triple:" + list(copy(makeTriple(1), makeReversed(2))));
print("copy through a setter:" + list(copy({ set second(value) { this.seen = value; } }, makeTriple(4))));
const source = makeTriple(5);
print("copy into an object that changes the source:" + list(copy({ set first(value) { remove(source, "third"); } }, source)));
print("first key: " + firstKey(makeTriple(1)) + " " + firstKey(makeReversed(1)) + " " + firstKey({}) + " " + firstKey(remove(makeTriple(1), "first")));

function skipSecond(object) {
  let seen = "";
  for (const key in object) {
    if (key === "second") continue;
    seen += key;
  }
  return seen;
}
function untilSecond(object) {
  let seen = "";
  for (const key in object) {
    if (key === "second") break;
    seen += key;
  }
  return seen;
}
function pairs(object) {
  let seen = "";
  outer: for (const a in object) {
    for (const b in object) {
      if (b === "third") continue outer;
      seen += a[0] + b[0] + " ";
    }
  }
  return seen;
}
function closures(object) {
  const list = [];
  for (const key in object) list.push(() => key);
  return list.map(f => f()).join();
}
function withFinally(object) {
  let seen = "";
  for (const key in object) {
    try {
      if (key === "second") continue;
      seen += key;
    } finally {
      seen += "!";
    }
  }
  return seen;
}
function* yielded(object) {
  for (const key in object) yield key;
}
function counted(object) {
  let count = 0, last;
  for (var key in object) {
    count++;
    last = key;
  }
  return count + " " + last + " " + key;
}
for (let round = 0; round < 3; round++) {
  const triple = makeTriple(round), reversed = makeReversed(round);
  print(skipSecond(triple), skipSecond(reversed), untilSecond(triple), untilSecond(reversed));
  print(pairs(triple), "|", pairs(reversed));
  print(closures(triple), closures(reversed), withFinally(triple), withFinally(reversed));
  print([...yielded(triple)].join(), [...yielded(reversed)].join(), counted(triple), counted(reversed), counted({}));
}
