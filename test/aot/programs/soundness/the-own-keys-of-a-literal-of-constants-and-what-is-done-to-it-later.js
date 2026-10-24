// A literal whose members are all constants lists its members, and whatever is added to it later.
function plain() { return { alpha: 1, beta: 2 }; }
function sumOf(table) { let sum = 0; for (const key of Object.keys(table)) sum += table[key]; return sum; }
console.log(Object.keys(plain()).join(), sumOf(plain()));

function added() { const table = { alpha: 1, beta: 2 }; table.gamma = 3; return table; }
console.log(Object.keys(added()).join(), sumOf(added()));

function computed(name) { const table = { alpha: 1, beta: 2 }; table[name] = 4; return table; }
console.log(Object.keys(computed("del" + "ta")).join(), sumOf(computed("del" + "ta")));

function removed() { const table = { alpha: 1, beta: 2 }; delete table.alpha; return table; }
console.log(Object.keys(removed()).join(), sumOf(removed()));

function numbered() { return { 2: "two", 0: "zero", name: "named", 1: "one" }; }
console.log(Object.keys(numbered()).join(), Object.getOwnPropertyNames(numbered()).join(), numbered()[Object.keys(numbered())[0]]);

function inner() { return { outer: { left: 1, right: 2 }, list: [1, 2] }; }
console.log(Object.keys(inner().outer).join(), Object.keys(inner().list).join(), Object.keys(inner()).join());

function assigned() { return Object.assign({ alpha: 1 }, { beta: 2 }, { [("gam" + "ma")]: 3 }); }
console.log(Object.keys(assigned()).join(), sumOf(assigned()));

function hiddenMember() { const table = { alpha: 1 }; Object.defineProperty(table, "unseen", { value: 2, enumerable: false }); return table; }
console.log(Object.keys(hiddenMember()).join(), Object.getOwnPropertyNames(hiddenMember()).join(), Reflect.ownKeys(hiddenMember()).length);

const mark = Symbol("mark");
function marked() { const table = { alpha: 1 }; table[mark] = 2; return table; }
console.log(Object.keys(marked()).join(), Reflect.ownKeys(marked()).length, marked()[Reflect.ownKeys(marked())[1]]);

function maybe(table) {
  try {
    return Object.keys(table).join();
  } catch (error) {
    return error instanceof TypeError;
  }
}
console.log(maybe({ alpha: 1, beta: 2 }), maybe(undefined), maybe(null), maybe("ab"), maybe(7), maybe([5, 6]));
