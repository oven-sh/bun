// A read by key of a string, a symbol or a bigint finds nothing and says undefined. `in` with the same key and the same value on its right throws a TypeError, however often the read came first,
// and Object.hasOwn says false. The same keys are then asked of objects, where `in` answers.
const keys = {
    literal: () => "abcd",
    ofAnObject: () => Object.keys({ abcd: 1 })[0],
    rope: () => "ab" + String(Date.now() > 0 ? "cd" : ""),
    ofBytes: () => Buffer.from([97, 233]).toString("latin1"),
    wide: () => "日本",
    symbol: () => Symbol.for("abcd"),
};
const held = {
    text: () => "abcdefgh",
    rope: () => "abcdefgh" + String(Date.now() > 0 ? "ijklmnop" : ""),
    textOfBytes: () => Buffer.from("abcd").toString(),
    symbol: () => Symbol("s"),
    big: () => 10n ** 30n,
    number: () => 7,
    yes: () => true,
    boxedText: () => new String("abcdefgh"),
    record: () => ({ other: 1 }),
    recordWithIt: () => ({ abcd: 1 }),
    list: () => [1, 2],
};
function read(key, value) { return typeof value[key]; }
function has(key, value) { try { return key in value; } catch (e) { return e.name; } }
function hasOwn(key, value) { return Object.hasOwn(value, key); }
function all(key, value) {
    let first, second, third, fourth;
    first = typeof value[key];
    try { second = key in value; } catch (e) { second = e.name; }
    third = Object.hasOwn(value, key);
    try { fourth = key in value; } catch (e) { fourth = e.name; }
    return [first, second, third, fourth].join(" ");
}
for (const [keyName, makeKey] of Object.entries(keys)) for (const [heldName, makeHeld] of Object.entries(held)) {
    const seen = [];
    const keptKey = makeKey(), keptHeld = makeHeld();
    for (let turn = 0; turn < 150; turn++) {
        const key = turn % 3 ? keptKey : makeKey(), value = turn % 5 ? keptHeld : makeHeld();
        const line = [read(key, value), has(key, value), hasOwn(key, value), all(key, value)].join(" ");
        if (!seen.includes(line)) seen.push(line);
    }
    console.log(keyName, heldName, seen.join(" | "));
}
