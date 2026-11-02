// A store through a `--define` value of one name goes to the variable that the text of a direct `eval` declared under that name, and to the global where the text declared none.
// Flags: --define NAME=target --define COUNT=count
globalThis.target = "the global";
globalThis.count = 10;
function store(text) {
  eval(text);
  NAME = "stored";
  COUNT++;
  COUNT += 5;
  [COUNT] = [COUNT * 2];
  return eval("[target, count].join()");
}
console.log(store("var target = 'declared', count = 1"), "|", globalThis.target, globalThis.count);
console.log(store(""), "|", globalThis.target, globalThis.count);
