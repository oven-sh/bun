// A for..in loop reads `walked[key]` and nobody uses what was read: it stands as a statement, behind `void`, or goes into a constant that is never read.
// A getter of the object, a getter of the object above it and the `get` trap of a proxy run all the same.

// Which of the two elements is taken, only the run knows.
const taken = pair => pair[process.argv.length - 1];

const first = taken([1, { get b() { console.log("at the top, a statement: the getter runs"); } }]);
for (const key in first) first[key];
console.log("at the top, a statement: end");

const second = taken([1, { get b() { console.log("at the top, void: the getter runs"); } }]);
for (const key in second) void second[key];
console.log("at the top, void: end");

const third = taken([1, { get b() { console.log("at the top, a constant: the getter runs"); } }]);
for (const key in third) {
  const unused = third[key];
}
console.log("at the top, a constant: end");

const ways = {
  "a statement"(walked) {
    for (const key in walked) walked[key];
  },
  "a statement in a block"(walked) {
    for (const key in walked) {
      walked[key];
    }
  },
  "void"(walked) {
    for (const key in walked) void walked[key];
  },
  "a constant"(walked) {
    for (const key in walked) {
      const unused = walked[key];
    }
  },
  "a variable declared outside"(walked) {
    let key;
    for (key in walked) walked[key];
  },
  "the left of a comma"(walked) {
    let turns = 0;
    for (const key in walked) (walked[key], turns++);
    console.log("  turns", turns);
  },
  "two reads"(walked) {
    for (const key in walked) {
      walked[key];
      walked[key];
    }
  },
};

const made = {
  "a getter": say => ({ plain: 1, get counted() { say("the getter runs"); return 2; }, last: 3 }),
  "a getter defined later": say =>
    Object.defineProperty({ plain: 1 }, "counted", { get() { say("the getter runs"); return 2; }, enumerable: true }),
  "a getter of the object above": say => Object.create({ get counted() { say("the getter runs"); return 2; } }),
  "a getter that throws": say => ({ get counted() { say("the getter runs"); throw new RangeError("thrown by the getter"); } }),
  "a proxy": say => new Proxy({ plain: 1, last: 3 }, { get(target, key) { say("the trap runs for " + String(key)); return target[key]; } }),
};

for (const [way, walk] of Object.entries(ways)) {
  for (const [what, make] of Object.entries(made)) {
    for (const [known, handed] of [["known", make], ["one of two", say => taken([1, make(say)])]]) {
      const label = `${way} | ${what} | ${known}`;
      try {
        walk(handed(words => console.log(label + ": " + words)));
        console.log(label + ": end");
      } catch (error) {
        console.log(label + ": " + error.name);
      }
    }
  }
}
