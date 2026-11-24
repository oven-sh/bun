// A text is looked for in fields of several structures, in the cell and in storage.
const hidden = value => JSON.parse("0", () => value);
const show = value => Array.isArray(value) ? "[" + Array.from(value, show) + "]" : value && typeof value === "object" ? "{" + value.name + "}" : String(value);
function work(list, c, t) {
    if (c === "never") {
        console.log("never", c * 2, c - 1, "x" + c, c % 3, c * 4, c - 5, "y" + c, c % 7);
        console.log("never", c * 3, c - 2, "z" + c, c % 4, c * 5, c - 6, "w" + c, c % 8);
    }
    switch (c) {
    case 0: return list.find(x => x.name === t);
    case 1: return list.some(x => x.name === t);
    case 2: return list.findIndex(x => x.name === "four and more");
    case 3: return list.filter(x => x.name === t);
    case 4: return list.map(x => x.name === t);
    case 5: return list.every(x => x.name !== t);
    }
}
const texts = JSON.parse('["one", "two", "three and more", "four and more", "five and more", "same", "sane", "some"]');
const grown = (object, count, name) => { for (let k = 0; k < count; k++) object["k" + k] = k; object.name = name; return object; };
const makers = [name => JSON.parse(JSON.stringify({ name })), name => JSON.parse(JSON.stringify({ a: 1, name })), name => grown({}, 90, name), name => grown({ b: 1 }, 100, name), name => ({ c: 1, name }), name => ({ name, d: 2, e: 3 }), name => grown(JSON.parse('{"f":1}'), 80, name)];
for (const picked of [[0], [2], [4], [0, 1], [2, 3], [2, 0], [0, 2, 3], [4, 5], [4, 2], [0, 1, 2, 3, 4, 5, 6], [6, 2, 3], [5, 6, 1]]) {
    for (const length of [1, 3, 8, 40]) {
        const list = hidden(Array.from({ length }, (_, i) => makers[picked[i % picked.length]](texts[i % texts.length])));
        let line = "";
        for (const text of texts)
            for (let c = 0; c < 6; c++)
                line += show(work(list, c, text)).slice(0, 60) + " ";
        console.log(line);
    }
}
