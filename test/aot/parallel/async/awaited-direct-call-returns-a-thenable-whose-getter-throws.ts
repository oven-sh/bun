// The callee of an awaited direct call returns a thenable: one whose getter `then` throws, one that resolves twice, one that resolves at once.
const log: string[] = [];
async function load(x: unknown) {
  await null;
  return x;
}
async function run(x: unknown) {
  try {
    return "given " + String(await load(x));
  } catch (e) {
    return "caught " + String(e);
  }
}
const getterThrows = {
  get then(): unknown {
    log.push("then is read");
    throw new Error("no then for you");
  },
};
const resolvesTwice = {
  then(resolve: (v: unknown) => void, reject: (e: unknown) => void) {
    log.push("then is called");
    resolve("first");
    resolve("second");
    reject("third");
  },
};
const resolvesAtOnce = {
  then(resolve: (v: unknown) => void) {
    log.push("at once");
    resolve("now");
  },
};
function deed(x: unknown) {
  return run(x);
}
console.log(await deed(getterThrows));
console.log(await deed(resolvesTwice));
console.log(await deed(resolvesAtOnce));
for (let i = 0; i < 3; i++) console.log(await deed(i % 2 ? getterThrows : resolvesTwice));
console.log(log.join(" | "));
