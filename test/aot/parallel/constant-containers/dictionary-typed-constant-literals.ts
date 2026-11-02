// Constant object literals whose declared type is a dictionary, made once at module level and again and again in functions: key order, odd keys, attributes, identity, and what later changes do.
const out: string[] = [];
function say(what: string, ...parts: unknown[]): void { out.push(what + ": " + parts.join(" ")); }
function show(o: object): string { return Object.keys(o).join(",") + " | " + JSON.stringify(o); }

const small: Readonly<Record<string, string>> = { "content-type": "text", accept: "all" };
say("small", show(small), small["content-type"], small.accept, small.missing, "accept" in small, Object.hasOwn(small, "toString"));

const large: Record<string, string> = {
    "key 0": "value 0",
    "key 1": "value 1",
    "key 2": "value 2",
    "key 3": "value 3",
    "key 4": "value 4",
    "key 5": "value 5",
    "key 6": "value 6",
    "key 7": "value 7",
    "key 8": "value 8",
    "key 9": "value 9",
    "key 10": "value 10",
    "key 11": "value 11",
    "key 12": "value 12",
    "key 13": "value 13",
    "key 14": "value 14",
    "key 15": "value 15",
    "key 16": "value 16",
    "key 17": "value 17",
    "key 18": "value 18",
    "key 19": "value 19",
    "key 20": "value 20",
    "key 21": "value 21",
    "key 22": "value 22",
    "key 23": "value 23",
    "key 24": "value 24",
    "key 25": "value 25",
    "key 26": "value 26",
    "key 27": "value 27",
    "key 28": "value 28",
    "key 29": "value 29",
    "key 30": "value 30",
    "key 31": "value 31",
    "key 32": "value 32",
    "key 33": "value 33",
    "key 34": "value 34",
    "key 35": "value 35",
    "key 36": "value 36",
    "key 37": "value 37",
    "key 38": "value 38",
    "key 39": "value 39",
    "key 40": "value 40",
    "key 41": "value 41",
    "key 42": "value 42",
    "key 43": "value 43",
    "key 44": "value 44",
    "key 45": "value 45",
    "key 46": "value 46",
    "key 47": "value 47",
    "key 48": "value 48",
    "key 49": "value 49",
    "key 50": "value 50",
    "key 51": "value 51",
    "key 52": "value 52",
    "key 53": "value 53",
    "key 54": "value 54",
    "key 55": "value 55",
    "key 56": "value 56",
    "key 57": "value 57",
    "key 58": "value 58",
    "key 59": "value 59",
    "key 60": "value 60",
    "key 61": "value 61",
    "key 62": "value 62",
    "key 63": "value 63",
    "key 64": "value 64",
    "key 65": "value 65",
    "key 66": "value 66",
    "key 67": "value 67",
    "key 68": "value 68",
    "key 69": "value 69",
    "key 70": "value 70",
    "key 71": "value 71",
    "key 72": "value 72",
    "key 73": "value 73",
    "key 74": "value 74",
    "key 75": "value 75",
    "key 76": "value 76",
    "key 77": "value 77",
    "key 78": "value 78",
    "key 79": "value 79",
    "key 80": "value 80",
    "key 81": "value 81",
    "key 82": "value 82",
    "key 83": "value 83",
    "key 84": "value 84",
    "key 85": "value 85",
    "key 86": "value 86",
    "key 87": "value 87",
    "key 88": "value 88",
    "key 89": "value 89",
    "key 90": "value 90",
    "key 91": "value 91",
    "key 92": "value 92",
    "key 93": "value 93",
    "key 94": "value 94",
    "key 95": "value 95",
    "key 96": "value 96",
    "key 97": "value 97",
    "key 98": "value 98",
    "key 99": "value 99",
    "key 100": "value 100",
    "key 101": "value 101",
    "key 102": "value 102",
    "key 103": "value 103",
    "key 104": "value 104",
    "key 105": "value 105",
    "key 106": "value 106",
    "key 107": "value 107",
    "key 108": "value 108",
    "key 109": "value 109",
    "key 110": "value 110",
    "key 111": "value 111",
    "key 112": "value 112",
    "key 113": "value 113",
    "key 114": "value 114",
    "key 115": "value 115",
    "key 116": "value 116",
    "key 117": "value 117",
    "key 118": "value 118",
    "key 119": "value 119",
    "key 120": "value 120",
    "key 121": "value 121",
    "key 122": "value 122",
    "key 123": "value 123",
    "key 124": "value 124",
    "key 125": "value 125",
    "key 126": "value 126",
    "key 127": "value 127",
    "key 128": "value 128",
    "key 129": "value 129",
    "key 130": "value 130",
    "key 131": "value 131",
    "key 132": "value 132",
    "key 133": "value 133",
    "key 134": "value 134",
    "key 135": "value 135",
    "key 136": "value 136",
    "key 137": "value 137",
    "key 138": "value 138",
    "key 139": "value 139",
    "key 140": "value 140",
    "key 141": "value 141",
    "key 142": "value 142",
    "key 143": "value 143",
    "key 144": "value 144",
    "key 145": "value 145",
    "key 146": "value 146",
    "key 147": "value 147",
    "key 148": "value 148",
    "key 149": "value 149",
};
say("large", Object.keys(large).length, Object.keys(large)[0], Object.keys(large)[149], large["key 77"], large["key " + (100 + 49)], large["key 150"]);
{
    let text = 0;
    for (const key in large) text += large[key]!.length;
    say("large, for in", text, Object.values(large)[75], Object.entries(large)[149]!.join("="));
}

const statuses: Record<number, string> = { 404: "Not Found", 200: "OK", 500: "Server Error", 301: "Moved", 100: "Continue", 204: "No Content", 302: "Found", 400: "Bad Request", 401: "Unauthorized", 403: "Forbidden", 409: "Conflict", 410: "Gone", 418: "Teapot", 429: "Too Many", 502: "Bad Gateway", 503: "Unavailable", 504: "Timeout", 4294967294: "last index", 4294967295: "no index" };
say("array indexes come first, in their own order", show(statuses), statuses[404], statuses[Number("200")], statuses[4294967295]);

const mixed: Record<string, unknown> = { b: 1, 2: "two", a: null, "-1": -1, 1: "one", "1.5": 1.5, "01": "not an index", "": "empty", "a b": undefined, length: 3, constructor: "own", toString: "own too", valueOf: 0, then: false, toJSON: 7n === 7n, hasOwnProperty: -0, name: NaN, prototype: [1, [2, { deep: { deeper: "x" } }]] };
say("odd keys", Object.keys(mixed).join("|"), mixed[""], mixed["a b"], "a b" in mixed, mixed.constructor, mixed.toString, Object.is(mixed.hasOwnProperty, -0), Object.is(mixed.name, NaN), JSON.stringify(mixed.prototype));

const keyA: string = "a", keyB: string = "b";
const repeated: Record<string, number> = { a: 1, b: 2, [keyA]: 3, c: 4, [keyB]: 5, d: 6, e: 7, f: 8, g: 9, h: 10, i: 11, j: 12, k: 13, l: 14, m: 15, n: 16, o: 17, p: 18, [keyA]: 19 };
say("a repeated key keeps its first place and its last value", show(repeated));

const ownProto: Record<string, unknown> = { a: 1, ["__proto__"]: 2, b: 3, c: 4, d: 5, e: 6, f: 7, g: 8, h: 9, i: 10, j: 11, k: 12, l: 13, m: 14, n: 15, o: 16, p: 17 };
say("a computed __proto__ is an own property", Object.keys(ownProto).join(","), Object.getPrototypeOf(ownProto) === Object.prototype, Object.getOwnPropertyDescriptor(ownProto, "__proto__")!.value);
const nullProto = { __proto__: null, a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8, i: 9, j: 10, k: 11, l: 12, m: 13, n: 14, o: 15, p: 16, q: 17 } as unknown as Record<string, number>;
say("a written __proto__ sets the prototype", Object.keys(nullProto).length, Object.getPrototypeOf(nullProto), "toString" in nullProto);

type Named = { name: string; size: number; [extra: string]: unknown };
const fieldsFirst: Named = { name: "fig", size: 3, x1: 1, x2: 2, x3: 3, x4: 4, x5: 5, x6: 6, x7: 7, x8: 8, x9: 9, x10: 10, x11: 11, x12: 12, x13: 13, x14: 14, x15: 15 };
const fieldsLast: Named = { x1: 1, x2: 2, x3: 3, x4: 4, x5: 5, x6: 6, x7: 7, x8: 8, x9: 9, x10: 10, x11: 11, x12: 12, x13: 13, x14: 14, x15: 15, name: "plum", size: 4 };
const fieldsBetween: Named = { x1: 1, name: "pear", 7: "seven", x2: 2, size: 5, x3: 3, x4: 4, x5: 5, x6: 6, x7: 7, x8: 8, x9: 9, x10: 10, x11: 11, x12: 12, x13: 13, x14: 14, x15: 15 };
say("declared members and others", show(fieldsFirst), show(fieldsLast), show(fieldsBetween), fieldsFirst.name, fieldsLast.size, fieldsBetween.x15);

const config: { flags: Record<string, "on" | "off">; nested: Record<string, Record<string, number[]>> }[] = [
    { flags: { "-a": "on", "-b": "off", "--long": "on" }, nested: { first: { x: [1, 2], y: [] }, second: {} } },
    { flags: {}, nested: { third: { z: [3] } } },
];
say("dictionaries inside records inside arrays", JSON.stringify(config), Object.keys(config[0]!.flags).join(","), config[1]!.nested.third!.z![0]);

function headers(): Record<string, string> { return { "content-type": "json", "x-one": "1", "x-two": "2" }; }
function table(): Record<string, number> { return { a0: 0, a1: 1, a2: 2, a3: 3, a4: 4, a5: 5, a6: 6, a7: 7, a8: 8, a9: 9, a10: 10, a11: 11, a12: 12, a13: 13, a14: 14, a15: 15, a16: 16, a17: 17, a18: 18, a19: 19 }; }
{
    const first = table(), second = table();
    first.a3 = 33; delete first.a0; first.added = 1; first[5] = 5;
    say("each evaluation makes its own object", first !== second, show(first), show(second), show(table()));
    let sum = 0;
    for (let i = 0; i < 3000; i++) { const t = table(), h = headers(); t["a" + (i % 20)]! += i; h["x-" + i] = "n"; sum += t.a7! + t.a19! + Object.keys(h).length + Object.keys(t).length; }
    say("made again and again", sum);
}

{
    const d = Object.getOwnPropertyDescriptor(large, "key 3")!;
    say("attributes", d.writable, d.enumerable, d.configurable, Object.isExtensible(large), Object.isFrozen(large), Object.getPrototypeOf(large) === Object.prototype);
    large["key 3"] = "changed"; delete large["key 0"]; large["key 0"] = "back"; large.more = "more";
    const keys = Object.keys(large);
    say("changes", keys.length, keys[0], keys[148], keys[149], keys[150], large["key 3"]);
    Object.freeze(large);
    let thrown = "";
    try { large["key 4"] = "no"; } catch (e) { thrown = (e as Error).constructor.name; }
    say("frozen", thrown, large["key 4"], Object.isFrozen(large));
    say("copies", Object.keys({ ...large }).length, Object.keys(Object.assign({}, statuses, small)).join(","), typeof structuredClone !== "function" || structuredClone(mixed.prototype) !== mixed.prototype);
}
console.log(out.join("\n"));
