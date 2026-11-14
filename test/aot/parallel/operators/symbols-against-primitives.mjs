// A symbol against every primitive and against objects, loosely and strictly, off places that hold few types.
const A = Symbol("A"), B = Symbol("B"), C = Symbol.for("C");
let text = "A", number = 1, flag = true, big = 5n, any = A, wrapped = Object(A), odd = { [Symbol.toPrimitive]() { return B; } };
const out = [];
function change(k) { text = k % 2 ? "A" : A; number = k % 3 ? k : B; flag = k % 5 === 0 ? C : k % 2 === 0; big = k % 4 ? 5n : A; any = [A, B, "A", 1, true, 5n, undefined, null, wrapped, odd, {}, () => A, 0.5, -0, ""][k % 15]; }
function ask() { return [text == A, A == text, text != A, number == B, B != number, flag == C, C == flag, big == A, A != big, any == A, any == B, A == any, text === A, number === B, flag === C].map(Number).join(""); }
for (let k = 0; k < 60; k++) { change(k); out.push(ask()); }
console.log(out.join("\n"));
let hits = 0; for (let k = 0; k < 3000; k++) { change(k); hits += (text == A) + (number == B) * 3 + (flag == C) * 7 + (big == A) * 11; } console.log(hits);
