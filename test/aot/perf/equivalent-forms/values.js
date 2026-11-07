// Pairs of loops that ask the same of the same values, written in two ways. ../equivalent-forms.test.ts says which pairs it holds together.
const which = process.argv[2] ?? "";
const rounds = Number(process.argv[3] ?? "64");

const PromiseInAConstant = Promise;
const things = [{ then: 1 }, [], Promise.resolve(1), { a: 1 }];

const double = x => x * 2;
function sumOf(list) {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return sum;
}

const text = "name=value; other=thing; third=one more";
function endOfWord(text, index) {
  while (index < text.length && text.charCodeAt(index) !== 59) index++;
  return index;
}
function endOfWordUnsigned(text, index) {
  while (index >>> 0 < text.length && text.charCodeAt(index) !== 59) index++;
  return index;
}

const loops = {
  "instanceof a constant that holds Promise": n => { let sum = 0; for (let i = 0; i < n; i++) if (things[i & 3] instanceof PromiseInAConstant) sum++; return sum; },
  "instanceof the global Promise": n => { let sum = 0; for (let i = 0; i < n; i++) if (things[i & 3] instanceof Promise) sum++; return sum; },
  "the elements of a literal": n => { let sum = 0; for (let i = 0; i < n; i++) sum += sumOf([double(i), double(1), double(2), double(3)]); return sum; },
  "the elements of what map answers": n => { let sum = 0; for (let i = 0; i < n; i++) sum += sumOf([i, 1, 2, 3].map(double)); return sum; },
  "an index compared as it is": n => { let sum = 0; for (let i = 0; i < n; i++) sum += endOfWord(text, i & 7); return sum; },
  "an index compared as an unsigned number": n => { let sum = 0; for (let i = 0; i < n; i++) sum += endOfWordUnsigned(text, i & 7); return sum; },
};

if (which) console.log(which, loops[which](rounds));
else for (const name in loops) console.log(name, loops[name](rounds), loops[name](3));
