// Module variables that start out as undefined, are compared with undefined before they are used, and are set back to undefined.
let cached: object | undefined;
let made = 0;

function make(): object {
  made++;
  return { made };
}

function get(): object {
  if (cached === undefined) cached = make();
  return cached;
}

function set(value: object | undefined) {
  cached = value;
}

const first = get();
console.log(first === get(), made);
set(undefined);
console.log(cached === undefined, first === get(), made);
set([undefined, first][made - 2]);
console.log(cached === undefined, get() === get(), made);
set([undefined, first][1]);
console.log(cached === first, get() === first, made);

let counter: number | undefined;
function next(): number {
  if (counter === undefined) counter = 0;
  return counter++;
}
console.log(next(), next(), next());

var hoisted;
console.log(hoisted, typeof hoisted, hoisted === undefined, hoisted == null, String(hoisted));
hoisted = null;
console.log(hoisted, hoisted === undefined);

function tag(strings: TemplateStringsArray) {
  return strings;
}
function template() {
  return tag`one`;
}
console.log(template() === template());

function recurse(depth: number): number {
  let sum = depth;
  const add = () => (sum += 1);
  if (depth) sum += recurse(depth - 1);
  return add();
}
console.log(recurse(5), recurse(3));
