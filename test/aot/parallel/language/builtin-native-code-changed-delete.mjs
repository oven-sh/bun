// The program changes a member of a built-in prototype that it has found under a computed name and that has been through native code. No other statement of the program changes that prototype.
// The change arrives, and compiled code sees it.
// Alone: what it prints hangs on what else the executable holds: which modules and members were compiled in, and whether anything evaluates text
const state = { hits: 0 };
function twice(read) {
  let sum = 0;
  for (let round = 0; round < 2; round++) sum += read();
  return sum;
}
function replacement(name) {
  return function replaced() {
    state.hits = state.hits + "h";
    return name + "!";
  };
}
const ways = {
  delete: (object, name) => delete object[name],
};
const table = [["DisposableStack", "use"], ["DisposableStack", "adopt"], ["DisposableStack", "defer"], ["DisposableStack", "move"], ["DisposableStack", "dispose"], ["AsyncDisposableStack", "use"], ["AsyncDisposableStack", "adopt"], ["AsyncDisposableStack", "defer"], ["AsyncDisposableStack", "move"]];
const stack = new DisposableStack();
const asyncStack = new AsyncDisposableStack();
const uses = [() => stack.use(), () => stack.adopt(), () => stack.defer(), () => stack.move(), () => stack.dispose(), () => asyncStack.use(), () => asyncStack.adopt(), () => asyncStack.defer(), () => asyncStack.move()];
let index = 0;
for (const [way, change] of Object.entries(ways)) {
  const [holder, name] = table[index];
  const object = globalThis[holder].prototype;
  Reflect.get(object, "mark", object);
  let verdict;
  try {
    verdict = String(change(object, name));
  } catch (error) {
    verdict = "refused (" + error.constructor.name + ")";
  }
  let answer;
  try {
    answer = twice(uses[index]);
  } catch (error) {
    answer = error.constructor.name;
  }
  console.log(way + ":", name, verdict, answer, twice(() => state.hits));
  index++;
}
