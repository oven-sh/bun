// An async function in which nothing suspends returns an object whose getter `then` writes the field that the caller has read in front of the call and reads again behind it.
// Under: --aot-testing=CheckProofsAtRunTime: nothing that a test of a value shows: the answer turns on the effects of the call (callRunsWholeBodyOfCoroutine())
async function hand(value) {
  return value;
}
async function touch(box) {
  box.n = box.n + 1;
}
function plain(box) {
  const before = box.n;
  touch(box);
  return before * 10 + box.n;
}
function deed(box, handed) {
  const before = box.n;
  hand(handed);
  return before * 10 + box.n;
}
const writer = box => ({
  get then() {
    box.n = box.n + 3;
    return undefined;
  },
});
const marked = box => {
  const promise = Promise.resolve(0);
  Object.defineProperty(promise, "then", {
    get() {
      box.n = box.n + 4;
      return undefined;
    },
  });
  return promise;
};
let box = { n: 1 };
console.log(plain(box), deed(box, 5), deed(box, writer(box)), deed(box, marked(box)));
for (let i = 0; i < 300; i++) {
  box = { n: 1 };
  if (plain(box) !== 12) console.log("plain is wrong at", i);
  if (deed(box, "text") !== 22) console.log("a primitive is wrong at", i);
  if (deed(box, writer(box)) !== 25) console.log("the getter is wrong at", i);
  if (deed(box, marked(box)) !== 59) console.log("the promise is wrong at", i);
}
console.log(box.n);
