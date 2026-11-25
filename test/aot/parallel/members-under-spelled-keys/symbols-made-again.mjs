// A call of Symbol that runs more than once makes more than one symbol: no member under such a key has one name.
const classes = [], keys = [];
for (let i = 0; i < 3; i++) {
  const key = Symbol("turn");
  keys.push(key);
  classes.push(class { [key]() { return "turn " + i; } plain() { return i; } });
}
let once;
do {
  once = Symbol("once");
  classes.push(class { [once]() { return "once"; } plain() { return -1; } });
  keys.push(once);
} while (false);
function make(label) {
  const inner = Symbol(label);
  return [inner, class { [inner]() { return label; } plain() { return label.length; } }];
}
for (const label of ["a", "bb", "a"]) {
  const [key, made] = make(label);
  keys.push(key);
  classes.push(made);
}
function ask(objects, keys) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  let said = "";
  for (let turn = 0; turn < 200; turn++) {
    for (let i = 0; i < objects.length; i++) {
      for (let k = 0; k < keys.length; k++) {
        const found = objects[i][keys[k]];
        if (turn === 199) said += found === undefined ? "." : "(" + found.call(objects[i]) + " " + objects[i].plain() + ")";
      }
    }
  }
  return said + work;
}
console.log(ask(classes.map(one => new one()), keys));
