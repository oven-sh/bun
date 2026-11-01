// Flags: --aot-check=verify-each-pass
// The same, with nothing unknown in the way: the constructor that ResolveCalls turns into a body of its own changes the list that map() walks, in its own text.
const turns = process.argv.length + 2;
function line(name, run) { let answer; try { answer = run(); } catch (error) { answer = error.name + ": " + String(error.message).slice(0, 60); } console.log(name + ": " + answer); }
const show = made => JSON.stringify(made.map(each => each && typeof each === "object" && "value" in each ? each.value : each));
line("map, a constructor: a fraction at 1", () => {
  function Holder(value, index, all) { this.value = value; if (index === 0) { all[1] = 1.5; } }
  let text = "";
  for (let i = 0; i < turns; i++) { const source = [i + 1, i + 2, i + 3]; text += show(source.map((value, index, all) => new Holder(value, index, all))); }
  return text;
});
line("map, a class: a fraction at 1", () => {
  class Holder { constructor(value, index, all) { this.value = value; if (index === 0) { all[1] = 1.5; } } }
  let text = "";
  for (let i = 0; i < turns; i++) { const source = [i + 1, i + 2, i + 3]; text += show(source.map((value, index, all) => new Holder(value, index, all))); }
  return text;
});
line("map, a constructor that keeps the list and a second that changes what the first kept: a fraction at 1", () => {
  const kept = { all: null };
  function Keeper(value, all) { this.value = value; kept.all = all; }
  function Changer(value, index) { this.value = value; const all = kept.all; if (index === 0) { all[1] = 1.5; } }
  let text = "";
  for (let i = 0; i < turns; i++) { const source = [i + 1, i + 2, i + 3]; text += show(source.map((value, index, all) => new Changer(new Keeper(value, all).value, index))); }
  return text;
});
line("forEach, a constructor: a fraction at 1", () => {
  const seen = [];
  function Holder(value, index, all) { seen.push(value); if (index === 0) { all[1] = 1.5; } }
  for (let i = 0; i < turns; i++) { const source = [i + 1, i + 2, i + 3]; source.forEach((value, index, all) => { new Holder(value, index, all); }); }
  return JSON.stringify(seen);
});
line("map, a constructor: an object at 1", () => {
  function Holder(value, index, all) { this.value = value; if (index === 0) { all[1] = { toJSON() { return 'object'; } }; } }
  let text = "";
  for (let i = 0; i < turns; i++) { const source = [i + 1, i + 2, i + 3]; text += show(source.map((value, index, all) => new Holder(value, index, all))); }
  return text;
});
line("map, a class: an object at 1", () => {
  class Holder { constructor(value, index, all) { this.value = value; if (index === 0) { all[1] = { toJSON() { return 'object'; } }; } } }
  let text = "";
  for (let i = 0; i < turns; i++) { const source = [i + 1, i + 2, i + 3]; text += show(source.map((value, index, all) => new Holder(value, index, all))); }
  return text;
});
line("map, a constructor that keeps the list and a second that changes what the first kept: an object at 1", () => {
  const kept = { all: null };
  function Keeper(value, all) { this.value = value; kept.all = all; }
  function Changer(value, index) { this.value = value; const all = kept.all; if (index === 0) { all[1] = { toJSON() { return 'object'; } }; } }
  let text = "";
  for (let i = 0; i < turns; i++) { const source = [i + 1, i + 2, i + 3]; text += show(source.map((value, index, all) => new Changer(new Keeper(value, all).value, index))); }
  return text;
});
line("forEach, a constructor: an object at 1", () => {
  const seen = [];
  function Holder(value, index, all) { seen.push(value); if (index === 0) { all[1] = { toJSON() { return 'object'; } }; } }
  for (let i = 0; i < turns; i++) { const source = [i + 1, i + 2, i + 3]; source.forEach((value, index, all) => { new Holder(value, index, all); }); }
  return JSON.stringify(seen);
});
line("map, a constructor: a string at 2", () => {
  function Holder(value, index, all) { this.value = value; if (index === 0) { all[2] = 'two'; } }
  let text = "";
  for (let i = 0; i < turns; i++) { const source = [i + 1, i + 2, i + 3]; text += show(source.map((value, index, all) => new Holder(value, index, all))); }
  return text;
});
line("map, a class: a string at 2", () => {
  class Holder { constructor(value, index, all) { this.value = value; if (index === 0) { all[2] = 'two'; } } }
  let text = "";
  for (let i = 0; i < turns; i++) { const source = [i + 1, i + 2, i + 3]; text += show(source.map((value, index, all) => new Holder(value, index, all))); }
  return text;
});
line("map, a constructor that keeps the list and a second that changes what the first kept: a string at 2", () => {
  const kept = { all: null };
  function Keeper(value, all) { this.value = value; kept.all = all; }
  function Changer(value, index) { this.value = value; const all = kept.all; if (index === 0) { all[2] = 'two'; } }
  let text = "";
  for (let i = 0; i < turns; i++) { const source = [i + 1, i + 2, i + 3]; text += show(source.map((value, index, all) => new Changer(new Keeper(value, all).value, index))); }
  return text;
});
line("forEach, a constructor: a string at 2", () => {
  const seen = [];
  function Holder(value, index, all) { seen.push(value); if (index === 0) { all[2] = 'two'; } }
  for (let i = 0; i < turns; i++) { const source = [i + 1, i + 2, i + 3]; source.forEach((value, index, all) => { new Holder(value, index, all); }); }
  return JSON.stringify(seen);
});
line("map, a constructor: cut to one", () => {
  function Holder(value, index, all) { this.value = value; if (index === 0) { all.length = 1; } }
  let text = "";
  for (let i = 0; i < turns; i++) { const source = [i + 1, i + 2, i + 3]; text += show(source.map((value, index, all) => new Holder(value, index, all))); }
  return text;
});
line("map, a class: cut to one", () => {
  class Holder { constructor(value, index, all) { this.value = value; if (index === 0) { all.length = 1; } } }
  let text = "";
  for (let i = 0; i < turns; i++) { const source = [i + 1, i + 2, i + 3]; text += show(source.map((value, index, all) => new Holder(value, index, all))); }
  return text;
});
line("map, a constructor that keeps the list and a second that changes what the first kept: cut to one", () => {
  const kept = { all: null };
  function Keeper(value, all) { this.value = value; kept.all = all; }
  function Changer(value, index) { this.value = value; const all = kept.all; if (index === 0) { all.length = 1; } }
  let text = "";
  for (let i = 0; i < turns; i++) { const source = [i + 1, i + 2, i + 3]; text += show(source.map((value, index, all) => new Changer(new Keeper(value, all).value, index))); }
  return text;
});
line("forEach, a constructor: cut to one", () => {
  const seen = [];
  function Holder(value, index, all) { seen.push(value); if (index === 0) { all.length = 1; } }
  for (let i = 0; i < turns; i++) { const source = [i + 1, i + 2, i + 3]; source.forEach((value, index, all) => { new Holder(value, index, all); }); }
  return JSON.stringify(seen);
});
line("map, a constructor: emptied", () => {
  function Holder(value, index, all) { this.value = value; if (index === 0) { all.length = 0; } }
  let text = "";
  for (let i = 0; i < turns; i++) { const source = [i + 1, i + 2, i + 3]; text += show(source.map((value, index, all) => new Holder(value, index, all))); }
  return text;
});
line("map, a class: emptied", () => {
  class Holder { constructor(value, index, all) { this.value = value; if (index === 0) { all.length = 0; } } }
  let text = "";
  for (let i = 0; i < turns; i++) { const source = [i + 1, i + 2, i + 3]; text += show(source.map((value, index, all) => new Holder(value, index, all))); }
  return text;
});
line("map, a constructor that keeps the list and a second that changes what the first kept: emptied", () => {
  const kept = { all: null };
  function Keeper(value, all) { this.value = value; kept.all = all; }
  function Changer(value, index) { this.value = value; const all = kept.all; if (index === 0) { all.length = 0; } }
  let text = "";
  for (let i = 0; i < turns; i++) { const source = [i + 1, i + 2, i + 3]; text += show(source.map((value, index, all) => new Changer(new Keeper(value, all).value, index))); }
  return text;
});
line("forEach, a constructor: emptied", () => {
  const seen = [];
  function Holder(value, index, all) { seen.push(value); if (index === 0) { all.length = 0; } }
  for (let i = 0; i < turns; i++) { const source = [i + 1, i + 2, i + 3]; source.forEach((value, index, all) => { new Holder(value, index, all); }); }
  return JSON.stringify(seen);
});
line("map, a constructor: grown", () => {
  function Holder(value, index, all) { this.value = value; if (index === 0) { if (all.length < 6) all.push(all.length * 10); } }
  let text = "";
  for (let i = 0; i < turns; i++) { const source = [i + 1, i + 2, i + 3]; text += show(source.map((value, index, all) => new Holder(value, index, all))); }
  return text;
});
line("map, a class: grown", () => {
  class Holder { constructor(value, index, all) { this.value = value; if (index === 0) { if (all.length < 6) all.push(all.length * 10); } } }
  let text = "";
  for (let i = 0; i < turns; i++) { const source = [i + 1, i + 2, i + 3]; text += show(source.map((value, index, all) => new Holder(value, index, all))); }
  return text;
});
line("map, a constructor that keeps the list and a second that changes what the first kept: grown", () => {
  const kept = { all: null };
  function Keeper(value, all) { this.value = value; kept.all = all; }
  function Changer(value, index) { this.value = value; const all = kept.all; if (index === 0) { if (all.length < 6) all.push(all.length * 10); } }
  let text = "";
  for (let i = 0; i < turns; i++) { const source = [i + 1, i + 2, i + 3]; text += show(source.map((value, index, all) => new Changer(new Keeper(value, all).value, index))); }
  return text;
});
line("forEach, a constructor: grown", () => {
  const seen = [];
  function Holder(value, index, all) { seen.push(value); if (index === 0) { if (all.length < 6) all.push(all.length * 10); } }
  for (let i = 0; i < turns; i++) { const source = [i + 1, i + 2, i + 3]; source.forEach((value, index, all) => { new Holder(value, index, all); }); }
  return JSON.stringify(seen);
});
line("map, a constructor: a hole at 1", () => {
  function Holder(value, index, all) { this.value = value; if (index === 0) { delete all[1]; } }
  let text = "";
  for (let i = 0; i < turns; i++) { const source = [i + 1, i + 2, i + 3]; text += show(source.map((value, index, all) => new Holder(value, index, all))); }
  return text;
});
line("map, a class: a hole at 1", () => {
  class Holder { constructor(value, index, all) { this.value = value; if (index === 0) { delete all[1]; } } }
  let text = "";
  for (let i = 0; i < turns; i++) { const source = [i + 1, i + 2, i + 3]; text += show(source.map((value, index, all) => new Holder(value, index, all))); }
  return text;
});
line("map, a constructor that keeps the list and a second that changes what the first kept: a hole at 1", () => {
  const kept = { all: null };
  function Keeper(value, all) { this.value = value; kept.all = all; }
  function Changer(value, index) { this.value = value; const all = kept.all; if (index === 0) { delete all[1]; } }
  let text = "";
  for (let i = 0; i < turns; i++) { const source = [i + 1, i + 2, i + 3]; text += show(source.map((value, index, all) => new Changer(new Keeper(value, all).value, index))); }
  return text;
});
line("forEach, a constructor: a hole at 1", () => {
  const seen = [];
  function Holder(value, index, all) { seen.push(value); if (index === 0) { delete all[1]; } }
  for (let i = 0; i < turns; i++) { const source = [i + 1, i + 2, i + 3]; source.forEach((value, index, all) => { new Holder(value, index, all); }); }
  return JSON.stringify(seen);
});
line("map, a constructor: sparse", () => {
  function Holder(value, index, all) { this.value = value; if (index === 0) { all[100000] = 1; all.length = 3; } }
  let text = "";
  for (let i = 0; i < turns; i++) { const source = [i + 1, i + 2, i + 3]; text += show(source.map((value, index, all) => new Holder(value, index, all))); }
  return text;
});
line("map, a class: sparse", () => {
  class Holder { constructor(value, index, all) { this.value = value; if (index === 0) { all[100000] = 1; all.length = 3; } } }
  let text = "";
  for (let i = 0; i < turns; i++) { const source = [i + 1, i + 2, i + 3]; text += show(source.map((value, index, all) => new Holder(value, index, all))); }
  return text;
});
line("map, a constructor that keeps the list and a second that changes what the first kept: sparse", () => {
  const kept = { all: null };
  function Keeper(value, all) { this.value = value; kept.all = all; }
  function Changer(value, index) { this.value = value; const all = kept.all; if (index === 0) { all[100000] = 1; all.length = 3; } }
  let text = "";
  for (let i = 0; i < turns; i++) { const source = [i + 1, i + 2, i + 3]; text += show(source.map((value, index, all) => new Changer(new Keeper(value, all).value, index))); }
  return text;
});
line("forEach, a constructor: sparse", () => {
  const seen = [];
  function Holder(value, index, all) { seen.push(value); if (index === 0) { all[100000] = 1; all.length = 3; } }
  for (let i = 0; i < turns; i++) { const source = [i + 1, i + 2, i + 3]; source.forEach((value, index, all) => { new Holder(value, index, all); }); }
  return JSON.stringify(seen);
});
line("map, a constructor: an accessor at 1", () => {
  function Holder(value, index, all) { this.value = value; if (index === 0) { Object.defineProperty(all, 1, { get() { return 77; }, configurable: true, enumerable: true }); } }
  let text = "";
  for (let i = 0; i < turns; i++) { const source = [i + 1, i + 2, i + 3]; text += show(source.map((value, index, all) => new Holder(value, index, all))); }
  return text;
});
line("map, a class: an accessor at 1", () => {
  class Holder { constructor(value, index, all) { this.value = value; if (index === 0) { Object.defineProperty(all, 1, { get() { return 77; }, configurable: true, enumerable: true }); } } }
  let text = "";
  for (let i = 0; i < turns; i++) { const source = [i + 1, i + 2, i + 3]; text += show(source.map((value, index, all) => new Holder(value, index, all))); }
  return text;
});
line("map, a constructor that keeps the list and a second that changes what the first kept: an accessor at 1", () => {
  const kept = { all: null };
  function Keeper(value, all) { this.value = value; kept.all = all; }
  function Changer(value, index) { this.value = value; const all = kept.all; if (index === 0) { Object.defineProperty(all, 1, { get() { return 77; }, configurable: true, enumerable: true }); } }
  let text = "";
  for (let i = 0; i < turns; i++) { const source = [i + 1, i + 2, i + 3]; text += show(source.map((value, index, all) => new Changer(new Keeper(value, all).value, index))); }
  return text;
});
line("forEach, a constructor: an accessor at 1", () => {
  const seen = [];
  function Holder(value, index, all) { seen.push(value); if (index === 0) { Object.defineProperty(all, 1, { get() { return 77; }, configurable: true, enumerable: true }); } }
  for (let i = 0; i < turns; i++) { const source = [i + 1, i + 2, i + 3]; source.forEach((value, index, all) => { new Holder(value, index, all); }); }
  return JSON.stringify(seen);
});
line("map, a constructor: a prototype with 1", () => {
  function Holder(value, index, all) { this.value = value; if (index === 0) { delete all[1]; Object.setPrototypeOf(all, { 1: 88, __proto__: Array.prototype }); } }
  let text = "";
  for (let i = 0; i < turns; i++) { const source = [i + 1, i + 2, i + 3]; text += show(source.map((value, index, all) => new Holder(value, index, all))); }
  return text;
});
line("map, a class: a prototype with 1", () => {
  class Holder { constructor(value, index, all) { this.value = value; if (index === 0) { delete all[1]; Object.setPrototypeOf(all, { 1: 88, __proto__: Array.prototype }); } } }
  let text = "";
  for (let i = 0; i < turns; i++) { const source = [i + 1, i + 2, i + 3]; text += show(source.map((value, index, all) => new Holder(value, index, all))); }
  return text;
});
line("map, a constructor that keeps the list and a second that changes what the first kept: a prototype with 1", () => {
  const kept = { all: null };
  function Keeper(value, all) { this.value = value; kept.all = all; }
  function Changer(value, index) { this.value = value; const all = kept.all; if (index === 0) { delete all[1]; Object.setPrototypeOf(all, { 1: 88, __proto__: Array.prototype }); } }
  let text = "";
  for (let i = 0; i < turns; i++) { const source = [i + 1, i + 2, i + 3]; text += show(source.map((value, index, all) => new Changer(new Keeper(value, all).value, index))); }
  return text;
});
line("forEach, a constructor: a prototype with 1", () => {
  const seen = [];
  function Holder(value, index, all) { seen.push(value); if (index === 0) { delete all[1]; Object.setPrototypeOf(all, { 1: 88, __proto__: Array.prototype }); } }
  for (let i = 0; i < turns; i++) { const source = [i + 1, i + 2, i + 3]; source.forEach((value, index, all) => { new Holder(value, index, all); }); }
  return JSON.stringify(seen);
});
line("map, a constructor: shifted", () => {
  function Holder(value, index, all) { this.value = value; if (index === 0) { all.shift(); } }
  let text = "";
  for (let i = 0; i < turns; i++) { const source = [i + 1, i + 2, i + 3]; text += show(source.map((value, index, all) => new Holder(value, index, all))); }
  return text;
});
line("map, a class: shifted", () => {
  class Holder { constructor(value, index, all) { this.value = value; if (index === 0) { all.shift(); } } }
  let text = "";
  for (let i = 0; i < turns; i++) { const source = [i + 1, i + 2, i + 3]; text += show(source.map((value, index, all) => new Holder(value, index, all))); }
  return text;
});
line("map, a constructor that keeps the list and a second that changes what the first kept: shifted", () => {
  const kept = { all: null };
  function Keeper(value, all) { this.value = value; kept.all = all; }
  function Changer(value, index) { this.value = value; const all = kept.all; if (index === 0) { all.shift(); } }
  let text = "";
  for (let i = 0; i < turns; i++) { const source = [i + 1, i + 2, i + 3]; text += show(source.map((value, index, all) => new Changer(new Keeper(value, all).value, index))); }
  return text;
});
line("forEach, a constructor: shifted", () => {
  const seen = [];
  function Holder(value, index, all) { seen.push(value); if (index === 0) { all.shift(); } }
  for (let i = 0; i < turns; i++) { const source = [i + 1, i + 2, i + 3]; source.forEach((value, index, all) => { new Holder(value, index, all); }); }
  return JSON.stringify(seen);
});
line("map, a constructor: popped", () => {
  function Holder(value, index, all) { this.value = value; if (index === 0) { all.pop(); } }
  let text = "";
  for (let i = 0; i < turns; i++) { const source = [i + 1, i + 2, i + 3]; text += show(source.map((value, index, all) => new Holder(value, index, all))); }
  return text;
});
line("map, a class: popped", () => {
  class Holder { constructor(value, index, all) { this.value = value; if (index === 0) { all.pop(); } } }
  let text = "";
  for (let i = 0; i < turns; i++) { const source = [i + 1, i + 2, i + 3]; text += show(source.map((value, index, all) => new Holder(value, index, all))); }
  return text;
});
line("map, a constructor that keeps the list and a second that changes what the first kept: popped", () => {
  const kept = { all: null };
  function Keeper(value, all) { this.value = value; kept.all = all; }
  function Changer(value, index) { this.value = value; const all = kept.all; if (index === 0) { all.pop(); } }
  let text = "";
  for (let i = 0; i < turns; i++) { const source = [i + 1, i + 2, i + 3]; text += show(source.map((value, index, all) => new Changer(new Keeper(value, all).value, index))); }
  return text;
});
line("forEach, a constructor: popped", () => {
  const seen = [];
  function Holder(value, index, all) { seen.push(value); if (index === 0) { all.pop(); } }
  for (let i = 0; i < turns; i++) { const source = [i + 1, i + 2, i + 3]; source.forEach((value, index, all) => { new Holder(value, index, all); }); }
  return JSON.stringify(seen);
});
line("map, a constructor: filled with fractions", () => {
  function Holder(value, index, all) { this.value = value; if (index === 0) { all.fill(0.5); } }
  let text = "";
  for (let i = 0; i < turns; i++) { const source = [i + 1, i + 2, i + 3]; text += show(source.map((value, index, all) => new Holder(value, index, all))); }
  return text;
});
line("map, a class: filled with fractions", () => {
  class Holder { constructor(value, index, all) { this.value = value; if (index === 0) { all.fill(0.5); } } }
  let text = "";
  for (let i = 0; i < turns; i++) { const source = [i + 1, i + 2, i + 3]; text += show(source.map((value, index, all) => new Holder(value, index, all))); }
  return text;
});
line("map, a constructor that keeps the list and a second that changes what the first kept: filled with fractions", () => {
  const kept = { all: null };
  function Keeper(value, all) { this.value = value; kept.all = all; }
  function Changer(value, index) { this.value = value; const all = kept.all; if (index === 0) { all.fill(0.5); } }
  let text = "";
  for (let i = 0; i < turns; i++) { const source = [i + 1, i + 2, i + 3]; text += show(source.map((value, index, all) => new Changer(new Keeper(value, all).value, index))); }
  return text;
});
line("forEach, a constructor: filled with fractions", () => {
  const seen = [];
  function Holder(value, index, all) { seen.push(value); if (index === 0) { all.fill(0.5); } }
  for (let i = 0; i < turns; i++) { const source = [i + 1, i + 2, i + 3]; source.forEach((value, index, all) => { new Holder(value, index, all); }); }
  return JSON.stringify(seen);
});
