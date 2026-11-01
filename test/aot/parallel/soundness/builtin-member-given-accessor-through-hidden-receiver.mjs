// A member of a built-in object that the program has written by name has no lock. Here it gets an accessor, or loses one, through a receiver and a key that the compiler cannot follow.
const hide = value => new CustomEvent("x", { detail: value }).detail;

let gets = 0;
Date.now = () => 1;
Object.defineProperty(hide(Date), hide("now"), {
  get() {
    gets++;
    return () => 2;
  },
});
function readsTwice() {
  const before = gets;
  const found = Date.now;
  const between = gets;
  const again = Date.now;
  return [between - before, gets - between, found === again, found()].join();
}
console.log(readsTwice(), readsTwice());

let parses = 0;
JSON.parse = () => "by name";
Object.defineProperty(hide(JSON), hide("parse"), {
  get() {
    parses++;
    return () => "hidden " + parses;
  },
});
let last;
for (let i = 0; i < 1000; i++) last = JSON.parse();
console.log(parses, last);

const stored = [];
console.table = () => "by name";
Object.defineProperty(hide(console), hide("table"), {
  get() {
    return () => "got " + stored.length;
  },
  set(value) {
    stored.push(value);
  },
});
function storesTwice() {
  const before = stored.length;
  console.table = 1;
  console.table = 2;
  return stored.length - before;
}
console.log(storesTwice(), storesTwice(), console.table(), stored.join());

let uptimes = 0;
Object.defineProperty(process, "uptime", {
  get() {
    uptimes++;
    return () => 1;
  },
  configurable: true,
});
function readsUptime() {
  const before = uptimes;
  const found = process.uptime;
  return [uptimes - before, typeof found, Array.isArray(found)].join();
}
console.log(readsUptime());
Object.defineProperty(hide(process), hide("uptime"), { value: [1, 2], configurable: true, writable: true });
console.log(readsUptime());

let trims = 0;
String.prototype.trim = function () {
  return "by name";
};
Object.defineProperty(hide(String.prototype), hide("trim"), {
  get() {
    trims++;
    return function () {
      return "hidden " + this;
    };
  },
});
function trim(text) {
  const before = trims;
  const answer = text.trim();
  return answer + " " + (trims - before);
}
console.log(trim("a"), trim("b"));
