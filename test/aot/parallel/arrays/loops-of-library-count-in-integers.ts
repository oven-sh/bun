// some | every | forEach | map | filter | find | findIndex | findLast | reduce | indexOf over arrays of every kind of storage and over objects that only look like arrays:
// the index that the callback gets, what happens when the callback changes the array under the loop, and lengths up to 2 ** 53 - 1, where the counter is no index any more.
const launder = new Function("v", process.env.LAUNDER_TEXT ?? "return v") as <V>(v: V) => V;
const show = (label: string, ...values: unknown[]) => console.log(label, values.map((v) => (Object.is(v, -0) ? "-0" : typeof v === "object" ? JSON.stringify(v) : String(v))).join(" | "));
type Test = (value: unknown, index: number, list: unknown) => unknown;

function all(label: string, make: () => unknown[], test: Test) {
  const seen: string[] = [];
  const spy: Test = (value, index, list) => { seen.push(typeof index + ":" + index); return test(value, index, list); };
  show(label + " some", make().some(launder(spy)), seen.join(","));
  seen.length = 0; show(label + " every", make().every(launder(spy)), seen.join(","));
  seen.length = 0; make().forEach(launder(spy)); show(label + " forEach", seen.join(","));
  seen.length = 0; show(label + " map", make().map(launder(spy)), seen.join(","));
  seen.length = 0; show(label + " filter", make().filter(launder(spy)), seen.join(","));
  seen.length = 0; show(label + " find", make().find(launder(spy)), seen.join(","));
  seen.length = 0; show(label + " findIndex", make().findIndex(launder(spy)), seen.join(","));
  seen.length = 0; show(label + " findLast", make().findLast(launder(spy)), seen.join(","));
  seen.length = 0; show(label + " reduce", make().reduce((sum: number, value, index) => { seen.push(String(index)); return sum + index; }, 0), seen.join(","));
}

all("int32", () => [1, 2, 3, 4], (v) => v === 3);
all("doubles", () => [0.5, 1.5, 2.5], (v) => (v as number) > 2);
all("boxed", () => ["a", {}, 3, null], (v) => v === null);
all("holes", () => [1, , 3, , 5], (v) => v === 5);
all("holes alone", () => new Array(3), () => true);
all("empty", () => [], () => true);
all("from unseen code", () => launder(JSON.parse("[1,2,3]")), (v) => v === 2);
all("grows under the loop", () => [1, 2, 3], (v, i, list) => { (list as unknown[]).push(i); return false; });
all("shrinks under the loop", () => [1, 2, 3, 4, 5], (v, i, list) => { (list as unknown[]).length = 3; return false; });
all("emptied under the loop", () => [1, 2, 3], (v, i, list) => { (list as unknown[]).length = 0; return false; });
all("turns to doubles under the loop", () => [1, 2, 3], (v, i, list) => { (list as unknown[])[2] = 0.5; return false; });
all("turns to boxed under the loop", () => [1, 2, 3], (v, i, list) => { (list as unknown[])[2] = "text"; return false; });
all("gets a hole under the loop", () => [1, 2, 3], (v, i, list) => { delete (list as unknown[])[2]; return false; });
all("becomes sparse under the loop", () => [1, 2, 3], (v, i, list) => { (list as unknown[])[100000] = 1; (list as unknown[]).length = 3; return false; });
all("gets an accessor under the loop", () => [1, 2, 3], (v, i, list) => { if (!i) Object.defineProperty(list, "2", { get() { return "got"; }, configurable: true }); return v === "got"; });
all("gets another prototype under the loop", () => [1, , 3], (v, i, list) => { Object.setPrototypeOf(list, { 1: "inherited", __proto__: Array.prototype }); return v === "inherited"; });

const methods = ["some", "every", "forEach", "map", "filter", "find", "findIndex", "indexOf", "includes", "lastIndexOf"] as const;
function onObject(label: string, make: () => object, limit: number) {
  for (const name of methods) {
    const seen: number[] = [];
    let result: unknown;
    try {
      const method = (Array.prototype as any)[name] as Function;
      result = name === "indexOf" || name === "includes" || name === "lastIndexOf"
        ? method.call(make(), "wanted")
        : method.call(make(), launder((value: unknown, index: number) => { seen.push(index); if (seen.length >= limit) { if (name === "every") return false; if (name === "forEach" || name === "map" || name === "filter") throw new Error("enough"); return true; } return name === "every"; }));
    } catch (error) { result = (error as Error).constructor.name + ": " + (error as Error).message; }
    show(label + " " + name, result, seen.join(","));
  }
}
onObject("three", () => ({ length: 3, 0: "a", 1: "wanted", 2: "c" }), 9);
onObject("length is text", () => ({ length: "2", 0: "a", 1: "wanted" }), 9);
onObject("length is a fraction", () => ({ length: 2.9, 0: "a", 1: "b", 2: "wanted" }), 9);
onObject("length is negative", () => ({ length: -5, 0: "wanted" }), 9);
onObject("length is NaN", () => ({ length: NaN, 0: "wanted" }), 9);
onObject("text", () => new String("abc"), 9);
onObject("typed array", () => new Uint8Array([1, 2, 3]), 9);
function early(label: string, length: number, keys: number[]) {
  const object: Record<string, unknown> = { length };
  for (const key of keys) object[key] = "at " + key;
  const seen: string[] = [];
  show(label, Array.prototype.find.call(launder(object), (value: unknown, index: number) => { seen.push(index + "=" + value); return seen.length === 3; }), seen.join(","));
  seen.length = 0;
  show(label + " from the end", Array.prototype.findLast.call(launder(object), (value: unknown, index: number) => { seen.push(index + "=" + value); return seen.length === 3; }), seen.join(","));
}
early("2 ** 32 - 1", 4294967295, [0, 4294967294]);
early("2 ** 32", 4294967296, [1, 4294967295]);
early("2 ** 32 + 2", 4294967298, [2, 4294967297, 4294967296]);
early("2 ** 53 - 1", 9007199254740991, [0, 9007199254740990, 9007199254740989]);
early("beyond 2 ** 53", 9007199254740993, [9007199254740990]);
early("Infinity", Infinity, [9007199254740990, 9007199254740988]);
