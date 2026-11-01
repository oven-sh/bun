// No literal and no class of this program has the names tint, girth or heft: only objects out of JSON.parse have them.
// Every read below stands in a loop, and what comes to it changes while the loop runs.
const lines = [];
function show(label, value) {
  lines.push(label + " " + String(value));
}

function sumOfGirths(list) {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i].girth;
  return sum;
}
function tints(list) {
  let text = "";
  for (let i = 0; i < list.length; i++) text += list[i].tint + ",";
  return text;
}
function twice(list) {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i].heft * list[i].heft;
  return sum;
}
function byTint(list) {
  let sum = 0;
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    if (item.tint === "red") sum += item.girth + item.girth;
    else sum += item.heft;
  }
  return sum;
}
function throwing(list) {
  let caught = 0;
  let sum = 0;
  for (let i = 0; i < list.length; i++) {
    try {
      sum += list[i].girth;
    } catch (error) {
      caught += error instanceof TypeError ? 1 : 100;
    }
  }
  return sum + " caught " + caught;
}

function parsedList(count, make) {
  let text = "[";
  for (let i = 0; i < count; i++) text += (i ? "," : "") + make(i);
  return JSON.parse(text + "]");
}

const oneForm = parsedList(300, i => `{"tint":"t${i % 7}","girth":${i}}`);
show("one form", sumOfGirths(oneForm));
show("one form again", sumOfGirths(oneForm));
show("one form tints", tints(oneForm).length);

const twoForms = parsedList(300, i => (i % 3 ? `{"tint":"red","girth":${i + 0.5}}` : `{"tint":"blue","heft":${i + 0.25}}`));
for (let turn = 0; turn < 20; turn++) show("two forms " + turn, byTint(twoForms));

const otherPlaces = parsedList(300, i => (i % 2 ? `{"girth":${i},"tint":"x"}` : `{"a${i % 5}":0,"tint":"y","girth":${i}}`));
show("other places", sumOfGirths(otherPlaces));
show("other places tints", tints(otherPlaces).length);

const wide = parsedList(100, i => {
  let text = "{";
  for (let k = 0; k < 40; k++) text += `"k${k}":${k},`;
  return text + `"girth":${i},"heft":${i + 1}}`;
});
show("outside the cell", sumOfGirths(wide));
show("outside the cell twice", twice(wide));

const absent = parsedList(100, i => (i % 4 ? `{"tint":"z"}` : `{"tint":"z","girth":1}`));
show("absent", sumOfGirths(absent));

const mixed = parsedList(60, i => `{"girth":${i}}`);
mixed[5] = 7;
mixed[6] = "text";
mixed[7] = true;
mixed[8] = [1, 2];
mixed[9] = Symbol("s");
mixed[10] = 10n;
mixed[11] = function () {};
show("what is no object", sumOfGirths(mixed));
mixed[12] = null;
mixed[13] = undefined;
show("null and undefined", throwing(mixed));

const nameOfGirth = ["gi", "rth"].join("");
Object.defineProperty(Number.prototype, nameOfGirth, { get() { return this + 1000; }, configurable: true });
Object.defineProperty(String.prototype, nameOfGirth, { value: 5, configurable: true });
show("above primitives", throwing(mixed));
delete Number.prototype[nameOfGirth];
delete String.prototype[nameOfGirth];
show("above primitives no more", throwing(mixed));

const changing = parsedList(200, i => `{"tint":"c","girth":${i},"heft":2}`);
show("before changes", sumOfGirths(changing));
for (let i = 0; i < changing.length; i += 5) delete changing[i][nameOfGirth];
show("deleted", sumOfGirths(changing));
for (let i = 0; i < changing.length; i += 5) changing[i][nameOfGirth] = 1;
show("added again", sumOfGirths(changing));
let calls = 0;
for (let i = 1; i < changing.length; i += 5) Object.defineProperty(changing[i], nameOfGirth, { get() { calls++; return 3; }, configurable: true });
show("getters", sumOfGirths(changing) + " calls " + calls);
for (let i = 2; i < changing.length; i += 5) Object.freeze(changing[i]);
show("frozen", sumOfGirths(changing));
for (let i = 3; i < changing.length; i += 5) changing[i][nameOfGirth] = "s";
show("strings", sumOfGirths(changing).length);

const above = JSON.parse(`{"girth":40,"heft":3}`);
const below = parsedList(100, i => (i % 2 ? `{"tint":"b"}` : `{"tint":"b","girth":1}`));
for (const item of below) Object.setPrototypeOf(item, above);
show("inherited", sumOfGirths(below));
above[nameOfGirth] = 41;
show("inherited and changed", sumOfGirths(below));
delete above[nameOfGirth];
show("inherited and gone", sumOfGirths(below));
show("inherited twice", twice(below));

let traps = 0;
const proxies = parsedList(50, i => `{"girth":${i}}`).map((item, i) => (i % 2 ? item : new Proxy(item, { get(target, key) { traps++; return target[key] + 1; } })));
show("proxies", sumOfGirths(proxies) + " traps " + traps);

let reads = 0;
const counted = parsedList(50, i => `{"tint":"n"}`);
for (const item of counted) Object.defineProperty(item, ["he", "ft"].join(""), { get() { return ++reads; } });
show("a getter is called for each of two reads", twice(counted) + " reads " + reads);

for (let round = 0; round < 6; round++) {
  const fresh = parsedList(200, i => `{"r${round}x${i % 50}":1,"girth":${i},"tint":"g"}`);
  show("forms that die " + round, sumOfGirths(fresh) + tints(fresh).length);
  if (typeof Bun !== "undefined") Bun.gc(true);
}
show("after collections", sumOfGirths(oneForm) + byTint(twoForms));

console.log(lines.join("\n"));
