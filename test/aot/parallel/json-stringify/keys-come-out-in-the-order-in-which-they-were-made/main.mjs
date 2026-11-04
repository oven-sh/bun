// One layout, and objects that got their keys in every order: by a literal, by stores, by a deletion and a store, by a copy.
function forward(a, b, c) { return { a, b, c }; }
function backward(a, b, c) { return { c, b, a }; }
function stored(a, b, c) { const o = { b }; o.c = c; o.a = a; return o; }
function again(a, b, c) { const o = forward(a, b, c); delete o.a; o.a = a; return o; }
function fewer(a, b, c) { const o = forward(a, b, c); delete o.b; return o; }
function copied(a, b, c) { return { ...backward(a, b, c) }; }
for (const make of [forward, backward, stored, again, fewer, copied, forward]) {
    for (let i = 0; i < 2; ++i) console.log(make.name, JSON.stringify(make(i, i + 1, i + 2)));
}
