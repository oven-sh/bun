// The elements of an array are parsed with the names of the element in front at hand. Every way in which an element may differ from the one in front, in 8-bit and in 16-bit texts.
const texts = [
    '[{"a":1,"b":2},{"a":3,"b":4},{"a":5,"b":6}]',
    '[{"a":1,"b":2},{"a":3},{"a":5,"b":6},{"a":7,"b":8,"c":9},{"a":1,"b":2}]',
    '[{"a":1,"b":2},{"b":3,"a":4},{"a":5,"b":6},{"b":7,"a":8}]',
    '[{"a":1,"b":2},{"a":3,"c":4},{"a":5,"b":6},{"a":7,"c":8},{"a":9,"c":10}]',
    '[{"a":1,"b":2},{"ab":3,"b":4},{"a" :5,"b": 6},{ "a":7 , "b":8 },{"a":\n9,"b":\t10}]',
    '[{"a":1,"a":2},{"a":3,"a":4},{"a":5}]',
    '[{},{"a":1},{},{"a":2},{"a":3}]',
    '[{"a":{"x":[{"p":1},{"p":2},{"q":3}]},"b":1},{"a":{"x":[{"p":4},{"q":5}]},"c":2},{"a":{"x":[]},"b":3}]',
    '[{"aVeryLongNameOfAMemberIndeed":1,"b":2},{"aVeryLongNameOfAMemberIndeed":3,"b":4},{"aVeryLongNameOfAMemberIndeeX":5,"b":6}]',
    '[{"fourteenBytes":1,"b":2},{"fourteenBytes":3,"b":4},{"fourteenBytez":5,"b":6},{"thirteenByte":7},{"thirteenByte":8}]',
    '[{"a":1,"b":"x","c":true,"d":null,"e":1.5,"f":[1],"g":{"h":1}},{"a":-1,"b":"y","c":false,"d":null,"e":1e3,"f":[],"g":{}},{"a":0,"b":"","c":true,"d":0,"e":-0,"f":[[]],"g":{"h":2}}]',
    '[{"0":1,"a":2},{"0":3,"a":4},{"a":5,"0":6}]',
    '[{"__proto__":1,"a":2},{"__proto__":3,"a":4},{"a":5}]',
    '[{"\\u0061":1,"b":2},{"a":3,"b":4},{"\\u0061":5,"b":6}]',
    '[{"é":1,"b":2},{"é":3,"b":4},{"e":5,"b":6}]',
    '[{"中":1,"b":2},{"中":3,"b":4},{"丮":5,"b":6}]',
    '[[{"a":1}],[{"a":2},{"a":3}],{"a":4},{"a":5},1,{"a":6},"s",{"a":7}]',
    '[' + Array.from({ length: 20 }, (_, i) => '{' + Array.from({ length: 15 }, (_, j) => `"k${j}":${i + j}`).join() + '}').join() + ']',
    '[' + Array.from({ length: 6 }, (_, i) => '{' + Array.from({ length: 70 }, (_, j) => `"k${j}":${i + j}`).join() + '}').join() + ']',
];
const bad = ['[{"a":1,"b":2},{"a":3,"b":4]', '[{"a":1,"b":2},{"a":3,"b"}]', '[{"a":1},{"a":}]', '[{"a":1},{"a":1,}]', '[{"a":1},{"a" 1}]', '[{"a":1},{"a":01}]', '[{"a":1},{"a":1', '[{"a":1},{"a"'];
const launder = new Function("value", process.argv[2] ?? "return value") as <V>(value: V) => V;
const parse = launder(JSON.parse);
const lines: string[] = [];
for (let round = 0; round < 3; round++) {
    for (const text of texts) {
        const value = parse(text) as unknown[];
        lines.push(JSON.stringify(value) + " " + value.map(element => element !== null && typeof element === "object" ? Object.keys(element).join("") : typeof element).join());
        lines.push(JSON.stringify(new TextDecoder().decode(new TextEncoder().encode(text)) === text));
    }
    for (const text of bad) {
        try { parse(text); lines.push("parsed"); } catch (error) { lines.push((error as Error).name); }
    }
}
let hash = 0;
for (const line of lines) for (let i = 0; i < line.length; i++) hash = (hash * 31 + line.charCodeAt(i)) | 0;
console.log(lines.length, hash);
console.log(lines.slice(0, 46).map(line => line.length > 300 ? line.slice(0, 150) + ".." + line.slice(-150) : line).join("\n"));
