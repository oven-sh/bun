// Each member of 22 built-in prototypes is deleted, where that is allowed, and put back as it was. An heir then finds every member as before.
function describe(value) { return typeof value === "function" ? "function " + value.name : typeof value; }
function look(proto) {
    const parts = [];
    for (const key of Reflect.ownKeys(proto)) {
        const d = Reflect.getOwnPropertyDescriptor(proto, key);
        parts.push(String(key) + ":" + ("value" in d ? describe(d.value) : describe(d.get) + "/" + describe(d.set)) + (d.writable ? "w" : "") + (d.enumerable ? "e" : "") + (d.configurable ? "c" : ""));
    }
    return parts.sort().join();
}
function scene(title, proto) {
    const before = look(proto);
    let keys = 0;
    for (const key of Reflect.ownKeys(proto)) {
        keys++;
        const d = Reflect.getOwnPropertyDescriptor(proto, key);
        let gone = false;
        try { gone = delete proto[key]; } catch { }
        if (gone && !Reflect.defineProperty(proto, key, d))
            console.log(title, "cannot put back", String(key));
    }
    try { proto.aNameNothingHas = 1; delete proto.aNameNothingHas; } catch { }
    console.log(title, keys, before === look(proto));
}
const prototypes = {
    Map: Map.prototype, Set: Set.prototype, WeakMap: WeakMap.prototype, Date: Date.prototype, TypedArray: Object.getPrototypeOf(Uint8Array.prototype), ArrayBuffer: ArrayBuffer.prototype,
    Symbol: Symbol.prototype, Number: Number.prototype, Error: Error.prototype, DataView: DataView.prototype, Buffer: Buffer.prototype, URL: URL.prototype, Headers: Headers.prototype,
    Request: Request.prototype, Response: Response.prototype, URLSearchParams: URLSearchParams.prototype, EventTarget: EventTarget.prototype, AbortSignal: AbortSignal.prototype, Blob: Blob.prototype,
    TextDecoder: TextDecoder.prototype, String: String.prototype, Array: Array.prototype,
};
for (const title in prototypes)
    scene(title, prototypes[title]);
const map = new Map([[1, 2]]), set = new Set([1]), date = new Date(0), bytes = new Uint8Array([1, 2]), url = new URL("http://a.example/b?c=d");
console.log(map.get(1), map.size, set.has(1), set.size, date.getTime(), date.toISOString(), bytes.length, bytes.indexOf(2), url.pathname, url.searchParams.get("c"), "a,b".split(",").length, [3, 1].sort().join(), Buffer.from("a").toString("hex"));
