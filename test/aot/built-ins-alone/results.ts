import { lines, type Program } from "./program";

const programs: [string, string[], string[]][] = [
  [
    "bun-readable-stream-to-text-locks-the-stream",
    ["Bun.readableStreamToText"],
    [
      "const stream = new ReadableStream({",
      "  start(controller) {",
      '    controller.enqueue(new TextEncoder().encode("[1.5]"));',
      "    controller.close();",
      "  },",
      "});",
      "console.log(stream.locked);",
      "const waiting = Bun.readableStreamToText(stream);",
      "console.log(stream.locked, typeof (await waiting));",
    ],
  ],
  [
    "bun-readable-stream-to-json-locks-the-stream",
    ["Bun.readableStreamToJSON"],
    [
      "const stream = new ReadableStream({",
      "  start(controller) {",
      '    controller.enqueue(new TextEncoder().encode("[1.5]"));',
      "    controller.close();",
      "  },",
      "});",
      "console.log(stream.locked);",
      "const waiting = Bun.readableStreamToJSON(stream);",
      "console.log(stream.locked, typeof (await waiting));",
    ],
  ],
  [
    "bun-readable-stream-to-bytes-locks-the-stream",
    ["Bun.readableStreamToBytes"],
    [
      "const stream = new ReadableStream({",
      "  start(controller) {",
      '    controller.enqueue(new TextEncoder().encode("[1.5]"));',
      "    controller.close();",
      "  },",
      "});",
      "console.log(stream.locked);",
      "const waiting = Bun.readableStreamToBytes(stream);",
      "console.log(stream.locked, typeof (await waiting));",
    ],
  ],
  [
    "bun-readable-stream-to-array-buffer-locks-the-stream",
    ["Bun.readableStreamToArrayBuffer"],
    [
      "const stream = new ReadableStream({",
      "  start(controller) {",
      '    controller.enqueue(new TextEncoder().encode("[1.5]"));',
      "    controller.close();",
      "  },",
      "});",
      "console.log(stream.locked);",
      "const waiting = Bun.readableStreamToArrayBuffer(stream);",
      "console.log(stream.locked, typeof (await waiting));",
    ],
  ],
  [
    "bun-readable-stream-to-blob-locks-the-stream",
    ["Bun.readableStreamToBlob"],
    [
      "const stream = new ReadableStream({",
      "  start(controller) {",
      '    controller.enqueue(new TextEncoder().encode("[1.5]"));',
      "    controller.close();",
      "  },",
      "});",
      "console.log(stream.locked);",
      "const waiting = Bun.readableStreamToBlob(stream);",
      "console.log(stream.locked, typeof (await waiting));",
    ],
  ],
  [
    "bun-readable-stream-to-array-locks-the-stream",
    ["Bun.readableStreamToArray"],
    [
      "const stream = new ReadableStream({",
      "  start(controller) {",
      '    controller.enqueue(new TextEncoder().encode("[1.5]"));',
      "    controller.close();",
      "  },",
      "});",
      "console.log(stream.locked);",
      "const waiting = Bun.readableStreamToArray(stream);",
      "console.log(stream.locked, typeof (await waiting));",
    ],
  ],
  [
    "get-reader-locks-a-stream-and-release-lock-frees-it",
    ["ReadableStream"],
    [
      "const stream = new ReadableStream({",
      "  start(controller) {",
      '    controller.enqueue(new TextEncoder().encode("[1.5]"));',
      "    controller.close();",
      "  },",
      "});",
      "console.log(stream.locked);",
      "const reader = stream.getReader();",
      "console.log(stream.locked);",
      "reader.releaseLock();",
      "console.log(stream.locked);",
    ],
  ],
  [
    "a-body-is-used-after-it-is-read",
    ["Response.prototype.bodyUsed", "Response.prototype.text"],
    [
      'const response = new Response("abc");',
      "console.log(response.bodyUsed);",
      "const waiting = response.text();",
      "console.log(response.bodyUsed, (await waiting).length, response.bodyUsed);",
    ],
  ],
  [
    "the-size-of-a-map-and-a-set-is-read-before-and-after-a-change",
    ["Map.prototype.size", "Set.prototype.size"],
    [
      "const map = new Map();",
      "const set = new Set();",
      "console.log(map.size, set.size);",
      'map.set("a", 1);',
      "set.add(1);",
      "console.log(map.size, set.size);",
      "map.clear();",
      "set.delete(1);",
      "console.log(map.size, set.size);",
    ],
  ],
  [
    "the-last-index-of-a-pattern-is-read-before-and-after-exec",
    ["RegExp.prototype.exec", "RegExp.prototype.lastIndex"],
    [
      "const pattern = /a/g;",
      "console.log(pattern.lastIndex);",
      'pattern.exec("banana");',
      "console.log(pattern.lastIndex);",
      'pattern.test("banana");',
      "console.log(pattern.lastIndex);",
      '"banana".replace(pattern, "-");',
      "console.log(pattern.lastIndex);",
    ],
  ],
  [
    "the-members-of-a-url-are-read-before-and-after-a-store",
    ["URL.prototype.href", "URL.prototype.pathname", "URL.prototype.search"],
    [
      'const url = new URL("https://example.com/a?b=1");',
      "console.log(url.href, url.pathname, url.search);",
      'url.pathname = "/c";',
      "console.log(url.href, url.pathname);",
      'url.search = "";',
      "console.log(url.href, url.search.length, [...url.searchParams].length);",
    ],
  ],
  [
    "the-time-of-a-date-is-read-before-and-after-a-setter",
    ["Date.prototype.getTime", "Date.prototype.setTime", "Date.prototype.setUTCFullYear"],
    [
      "const date = new Date(0);",
      "console.log(date.getTime(), date.getUTCFullYear());",
      "date.setTime(86400000);",
      "console.log(date.getTime(), date.getUTCDate());",
      "date.setUTCFullYear(2000);",
      "console.log(date.getUTCFullYear(), date.toISOString());",
    ],
  ],
  [
    "the-byte-length-of-a-buffer-is-read-before-and-after-a-resize",
    ["ArrayBuffer.prototype.byteLength", "ArrayBuffer.prototype.resize", "%TypedArray%.prototype.length"],
    [
      "const buffer = new ArrayBuffer(4, { maxByteLength: 8 });",
      "const view = new Uint8Array(buffer);",
      "console.log(buffer.byteLength, view.length, view.byteLength);",
      "buffer.resize(8);",
      "console.log(buffer.byteLength, view.length, view.byteLength);",
    ],
  ],
  [
    "the-disposed-member-of-a-stack-is-read-before-and-after-dispose",
    ["DisposableStack.prototype.disposed", "DisposableStack.prototype.dispose"],
    [
      "const stack = new DisposableStack();",
      "console.log(stack.disposed);",
      "stack.dispose();",
      "console.log(stack.disposed);",
    ],
  ],
  [
    "headers-are-read-before-and-after-a-change",
    ["Headers.prototype.get", "Headers.prototype.set", "Headers.prototype.delete", "Headers.prototype.append"],
    [
      'const headers = new Headers({ a: "1" });',
      'console.log(headers.get("a"), headers.has("b"));',
      'headers.set("a", "2");',
      'headers.append("b", "3");',
      'console.log(headers.get("a"), headers.has("b"));',
      'headers.delete("a");',
      'console.log(headers.get("a") === null, [...headers.keys()].join());',
    ],
  ],
  [
    "the-aborted-member-of-a-signal-is-read-before-and-after-abort",
    ["AbortSignal"],
    [
      "const controller = new AbortController();",
      "const { signal } = controller;",
      "console.log(signal.aborted, signal.reason === undefined);",
      'controller.abort("stop");',
      "console.log(signal.aborted, signal.reason);",
    ],
  ],
  [
    "an-index-past-the-end-and-a-missing-name-are-undefined-honest",
    [],
    [
      "const list = [1.5];",
      "const record = { present: 1.5 };",
      "console.log(list[5] === undefined, typeof list[5], record.absent === undefined, list[0] + 1, record.present + 1);",
    ],
  ],
  [
    "a-list-and-an-object-made-by-literals-are-read-honest",
    [],
    [
      'const list = [1.5, "two", { three: 3 }];',
      'const record = { first: 1.5, second: "two" };',
      "console.log(list[0] + 1, list[1].length, list[2].three + 1, record.first + 1, record.second.length, Object.keys(record).join());",
    ],
  ],
  [
    "a-method-is-called-only-on-an-element-of-a-group-of-object-group-by",
    ["Object.groupBy"],
    [
      "class Item {",
      "  double() {",
      "    return 3;",
      "  }",
      "}",
      'const groups = Object.groupBy([new Item()], () => "all");',
      "console.log(groups.all[0].double());",
    ],
  ],
  [
    "a-store-through-a-group-of-object-group-by-reaches-the-element",
    ["Object.groupBy"],
    [
      "class Item {",
      "  size = 1;",
      "}",
      "const item = new Item();",
      'Object.groupBy([item], () => "all").all[0].size = "text";',
      "console.log(typeof item.size, item.size.length);",
    ],
  ],
  [
    "a-method-is-called-only-on-what-promise-race-settles-with",
    ["Promise.race"],
    [
      "class Item {",
      "  double() {",
      "    return 3;",
      "  }",
      "}",
      "console.log((await Promise.race([Promise.resolve(new Item())])).double());",
    ],
  ],
  [
    "a-method-is-called-only-on-what-promise-any-settles-with",
    ["Promise.any"],
    [
      "class Item {",
      "  double() {",
      "    return 3;",
      "  }",
      "}",
      "console.log((await Promise.any([Promise.resolve(new Item())])).double());",
    ],
  ],
  [
    "object-values-of-what-object-from-entries-made",
    ["Object.values", "Object.fromEntries"],
    [
      'const list = Object.values(Object.fromEntries([["a", 1.5]]));',
      "console.log(list.length, list[0], typeof list[0]);",
    ],
  ],
  [
    "object-values-of-what-object-create-made-from-descriptors",
    ["Object.values", "Object.create"],
    [
      "const list = Object.values(Object.create(null, { a: { value: 1.5, enumerable: true } }));",
      "console.log(list.length, list[0], typeof list[0]);",
    ],
  ],
  [
    "a-loop-over-object-values-of-what-object-from-entries-made",
    ["Object.values", "Object.fromEntries"],
    ['for (const value of Object.values(Object.fromEntries([["a", 1.5]]))) console.log(typeof value, value);'],
  ],
  [
    "a-spread-of-a-set-filled-by-add-is-read-by-index",
    ["Set.prototype.add", "%SetIterator%.prototype.next"],
    [
      "const set = new Set();",
      "set.add(1.5);",
      "const list = [...set];",
      "console.log(list.length, list[0], list[0] + 1, typeof list[0]);",
    ],
  ],
  [
    "a-spread-of-a-set-of-integers-filled-by-add-is-read-by-index",
    ["Set.prototype.add", "%SetIterator%.prototype.next"],
    ["const set = new Set();", "set.add(7);", "const list = [...set];", "console.log(list[0] + 1, list.join());"],
  ],
  [
    "a-spread-of-the-values-of-a-set-filled-by-add-is-read-by-index",
    ["Set.prototype.add", "Set.prototype.values"],
    [
      "const set = new Set();",
      "set.add(1.5);",
      "const list = [...set.values()];",
      "console.log(list[0] + 1, list.join());",
    ],
  ],
  [
    "a-spread-of-the-values-of-a-map-filled-by-set-is-read-by-index",
    ["Map.prototype.set", "Map.prototype.values"],
    [
      "const map = new Map();",
      'map.set("a", 1.5);',
      "const list = [...map.values()];",
      "console.log(list[0] + 1, list.join());",
    ],
  ],
  [
    "a-spread-of-the-keys-of-a-map-filled-by-set-is-read-by-index",
    ["Map.prototype.set", "Map.prototype.keys"],
    [
      "const map = new Map();",
      'map.set(1.5, "a");',
      "const list = [...map.keys()];",
      "console.log(list[0] + 1, list.join());",
    ],
  ],
  [
    "a-spread-of-a-set-made-from-a-list-is-read-by-index-honest",
    ["Set"],
    [
      "const set = new Set([1.5]);",
      "const list = [...set];",
      "console.log(list.length, list[0], list[0] + 1, typeof list[0]);",
    ],
  ],
  [
    "object-from-entries-of-a-list-of-pairs-is-read-by-name",
    ["Object.fromEntries"],
    [
      'const made = Object.fromEntries([["first", 1.5], ["second", "two"]]);',
      "console.log(made.first + 1, made.second.length, Object.keys(made).join(), JSON.stringify(made));",
    ],
  ],
  [
    "object-from-entries-of-a-map-is-read-by-name",
    ["Object.fromEntries"],
    [
      'const made = Object.fromEntries(new Map([["first", 1.5], ["second", "two"]]));',
      "console.log(made.first + 1, made.second.length, Object.keys(made).join());",
    ],
  ],
  [
    "object-from-entries-of-object-entries-keeps-the-members",
    ["Object.fromEntries", "Object.entries"],
    [
      'const made = Object.fromEntries(Object.entries({ first: 1.5, second: "two" }));',
      "console.log(made.first + 1, made.second.length);",
    ],
  ],
  [
    "object-from-entries-of-mapped-entries-keeps-the-members",
    ["Object.fromEntries", "Object.entries"],
    [
      "const made = Object.fromEntries(Object.entries({ first: 1.5, second: 2.5 }).map(([key, value]) => [key, value * 2]));",
      "console.log(made.first + 1, made.second + 1);",
    ],
  ],
  [
    "object-from-entries-is-read-by-a-pattern",
    ["Object.fromEntries"],
    [
      'const { first, second, third } = Object.fromEntries([["first", 1.5], ["second", "two"]]);',
      "console.log(first + 1, second.length, third === undefined);",
    ],
  ],
  [
    "object-from-entries-is-read-by-a-computed-name",
    ["Object.fromEntries"],
    [
      'const made = Object.fromEntries([["first", 1.5]]);',
      'for (const key of ["first", "missing"]) console.log(typeof made[key], made[key]);',
    ],
  ],
  [
    "object-group-by-is-read-by-name",
    ["Object.groupBy"],
    [
      'const groups = Object.groupBy([1.5, 2.5, "three"], value => typeof value);',
      "console.log(groups.number.length, groups.number[1] + 1, groups.string[0].length, Object.keys(groups).join());",
      "console.log(groups.boolean === undefined, Object.getPrototypeOf(groups) === null);",
    ],
  ],
  [
    "map-group-by-is-read-with-get",
    ["Map.groupBy"],
    [
      'const groups = Map.groupBy([1.5, 2.5, "three"], value => typeof value);',
      'console.log(groups.size, groups.get("number").length, groups.get("number")[1] + 1, groups.get("string")[0].length);',
      'console.log(groups.get("boolean") === undefined, groups.has("number"));',
    ],
  ],
  [
    "map-group-by-is-iterated",
    ["Map.groupBy"],
    [
      'const groups = Map.groupBy([1.5, 2.5, "three"], value => typeof value);',
      "for (const [key, values] of groups) console.log(key.length, values.length, typeof values[0]);",
    ],
  ],
  [
    "map-group-by-with-object-keys",
    ["Map.groupBy"],
    [
      "const small = { name: 1 };",
      "const large = { name: 2 };",
      "const groups = Map.groupBy([1.5, 20.5], value => (value > 10 ? large : small));",
      "console.log(groups.get(small)[0] + 1, groups.get(large)[0] + 1, [...groups.keys()][1].name + 1);",
    ],
  ],
  [
    "object-entries-is-read-by-index",
    ["Object.entries"],
    [
      'const entries = Object.entries({ first: 1.5, second: "two" });',
      "console.log(entries.length, entries[0][0].length, entries[0][1] + 1, entries[1][1].length);",
    ],
  ],
  [
    "object-entries-of-an-instance-is-read-by-a-pattern",
    ["Object.entries"],
    [
      "class Point {",
      "  x = 1.5;",
      '  label = "here";',
      "}",
      "for (const [key, value] of Object.entries(new Point())) console.log(key, typeof value, value);",
    ],
  ],
  [
    "object-values-of-an-instance-is-read-by-index",
    ["Object.values"],
    [
      "class Point {",
      "  x = 1.5;",
      '  label = "here";',
      "}",
      "const values = Object.values(new Point());",
      "console.log(values.length, values[0] + 1, values[1].length);",
    ],
  ],
  [
    "object-keys-of-an-instance-is-used-to-read-it",
    ["Object.keys"],
    [
      "class Point {",
      "  x = 1.5;",
      '  label = "here";',
      "}",
      "const point = new Point();",
      "for (const key of Object.keys(point)) console.log(key.length, typeof point[key], point[key]);",
    ],
  ],
  [
    "object-get-own-property-descriptors-is-read-by-name",
    ["Object.getOwnPropertyDescriptors"],
    [
      'const all = Object.getOwnPropertyDescriptors({ first: 1.5, get second() { return "two"; } });',
      "console.log(all.first.value + 1, all.first.writable, typeof all.second.get, all.second.get().length, all.second.value === undefined);",
    ],
  ],
  [
    "object-create-with-descriptors-is-read-by-name",
    ["Object.create"],
    [
      'const made = Object.create(null, { first: { value: 1.5, enumerable: true }, second: { get: () => "two" } });',
      "console.log(made.first + 1, made.second.length, Object.keys(made).join());",
    ],
  ],
  [
    "object-assign-into-a-fresh-literal-is-read-by-name",
    ["Object.assign"],
    [
      'const made = Object.assign({}, { first: 1.5 }, { second: "two" }, null, { first: "one" });',
      "console.log(made.first.length, made.second.length, Object.keys(made).join());",
    ],
  ],
  [
    "object-assign-of-a-string-spreads-its-characters",
    ["Object.assign"],
    ['const made = Object.assign({}, "ab");', "console.log(made[0], made[1].length, Object.keys(made).join());"],
  ],
  [
    "array-from-of-a-set-is-read-by-index",
    ["Array.from"],
    ['const list = Array.from(new Set([1.5, "two"]));', "console.log(list.length, list[0] + 1, list[1].length);"],
  ],
  [
    "array-from-of-a-map-is-read-by-index",
    ["Array.from"],
    [
      'const list = Array.from(new Map([["first", 1.5]]));',
      "console.log(list.length, list[0][0].length, list[0][1] + 1);",
    ],
  ],
  [
    "array-from-of-a-string-is-read-by-index",
    ["Array.from"],
    ['const list = Array.from("ab");', "console.log(list.length, list[1].length, list[1]);"],
  ],
  [
    "array-from-of-a-length-holds-undefined",
    ["Array.from"],
    [
      "const list = Array.from({ length: 2 });",
      "console.log(list.length, list[0] === undefined, 0 in list, typeof list[1]);",
    ],
  ],
  [
    "array-from-of-a-length-with-a-callback-holds-its-results",
    ["Array.from"],
    [
      "const list = Array.from({ length: 2 }, (value, index) => index + 0.5);",
      "console.log(list.length, list[0] + 1, list[1] + 1);",
    ],
  ],
  [
    "array-from-of-an-array-like-object-has-undefined-past-its-keys",
    ["Array.from"],
    [
      "const list = Array.from({ 0: 123, 1: 456, length: 3 });",
      "console.log(list.length, list[0] + 1, list[2] === undefined, 2 in list);",
    ],
  ],
  [
    "array-from-of-a-generator-is-read-by-index",
    ["Array.from"],
    [
      "function* values() {",
      "  yield 1.5;",
      '  yield "two";',
      "}",
      "const list = Array.from(values());",
      "console.log(list.length, list[0] + 1, list[1].length);",
    ],
  ],
  [
    "the-array-constructor-with-a-length-makes-holes",
    ["Array"],
    [
      "const list = new Array(3);",
      "console.log(list.length, 0 in list, list[0] === undefined, list.findIndex(each => each === undefined));",
    ],
  ],
  [
    "the-array-constructor-with-elements-is-read-by-index",
    ["Array"],
    [
      'const list = new Array(1.5, "two");',
      "console.log(list.length, list[0] + 1, list[1].length);",
      'const other = Array("one");',
      "console.log(other.length, other[0].length);",
    ],
  ],
  [
    "array-of-is-read-by-index",
    ["Array.of"],
    ['const list = Array.of(3, 1.5, "two");', "console.log(list.length, list[0] + 1, list[1] + 1, list[2].length);"],
  ],
  [
    "array-keys-values-and-entries-are-iterated",
    ["Array.prototype.keys", "Array.prototype.values", "Array.prototype.entries"],
    [
      'const list = [1.5, "two"];',
      "for (const key of list.keys()) console.log(key + 1);",
      "for (const value of list.values()) console.log(typeof value, value);",
      "for (const [key, value] of list.entries()) console.log(key + 1, typeof value);",
    ],
  ],
  [
    "an-array-iterator-past-the-end-answers-undefined",
    ["%ArrayIterator%.prototype.next"],
    [
      "const steps = [1.5].values();",
      "console.log(steps.next().value + 1);",
      "const last = steps.next();",
      "console.log(last.done, last.value === undefined, typeof last.value);",
    ],
  ],
  [
    "array-find-without-a-match-answers-undefined",
    ["Array.prototype.find"],
    [
      "const found = [1.5, 2.5].find(value => value > 9);",
      "console.log(found === undefined, typeof found, found ?? 0.5);",
    ],
  ],
  [
    "array-find-last-without-a-match-answers-undefined",
    ["Array.prototype.findLast"],
    [
      "const found = [1.5, 2.5].findLast(value => value > 9);",
      "console.log(found === undefined, typeof found, found ?? 0.5);",
    ],
  ],
  [
    "array-at-past-the-end-answers-undefined",
    ["Array.prototype.at"],
    [
      "const list = [1.5, 2.5];",
      "console.log(list.at(5) === undefined, list.at(-5) === undefined, list.at(-1) + 1, typeof list.at(2));",
    ],
  ],
  [
    "array-pop-of-an-empty-list-answers-undefined",
    ["Array.prototype.pop"],
    [
      "const list = [1.5];",
      "console.log(list.pop() + 1);",
      "const nothing = list.pop();",
      "console.log(nothing === undefined, typeof nothing);",
    ],
  ],
  [
    "array-shift-of-an-empty-list-answers-undefined",
    ["Array.prototype.shift"],
    [
      "const list = [1.5];",
      "console.log(list.shift() + 1);",
      "const nothing = list.shift();",
      "console.log(nothing === undefined, typeof nothing);",
    ],
  ],
  [
    "array-pop-of-a-list-that-ends-in-a-hole-answers-undefined",
    ["Array.prototype.pop"],
    [
      "const list = [1.5, ,];",
      "const nothing = list.pop();",
      "console.log(nothing === undefined, typeof nothing, list.length);",
    ],
  ],
  [
    "array-map-keeps-holes",
    ["Array.prototype.map"],
    [
      "const mapped = [1.5, , 2.5].map(value => value * 2);",
      "console.log(mapped.length, 1 in mapped, mapped[1] === undefined, mapped[2] + 1);",
    ],
  ],
  [
    "array-concat-keeps-holes",
    ["Array.prototype.concat"],
    [
      "const joined = [1.5, ,].concat([, 2.5]);",
      "console.log(joined.length, 1 in joined, 2 in joined, joined[1] === undefined, joined[3] + 1);",
    ],
  ],
  [
    "array-slice-keeps-holes",
    ["Array.prototype.slice"],
    ["const part = [1.5, , 2.5].slice(1);", "console.log(part.length, 0 in part, part[0] === undefined, part[1] + 1);"],
  ],
  [
    "array-to-sorted-turns-holes-into-undefined",
    ["Array.prototype.toSorted"],
    [
      "const sorted = [2.5, , 1.5].toSorted();",
      "console.log(sorted.length, 2 in sorted, sorted[2] === undefined, sorted[0] + 1);",
    ],
  ],
  [
    "array-to-reversed-turns-holes-into-undefined",
    ["Array.prototype.toReversed"],
    [
      "const reversed = [2.5, , 1.5].toReversed();",
      "console.log(reversed.length, 1 in reversed, reversed[1] === undefined, reversed[0] + 1);",
    ],
  ],
  [
    "array-flat-drops-holes",
    ["Array.prototype.flat"],
    ["const flat = [1.5, , [2.5, ,]].flat();", "console.log(flat.length, flat[1] + 1);"],
  ],
  [
    "array-includes-finds-undefined-in-a-hole",
    ["Array.prototype.includes", "Array.prototype.indexOf"],
    ["const list = [1.5, ,];", "console.log(list.includes(undefined), list.indexOf(undefined));"],
  ],
  [
    "array-join-writes-nothing-for-null-undefined-and-holes",
    ["Array.prototype.join"],
    ['console.log([1.5, null, undefined, , "two"].join("-"));'],
  ],
  [
    "map-get-of-a-missing-key-answers-undefined",
    ["Map.prototype.get"],
    [
      'const sizes = new Map([["small", 1.5]]);',
      'const missing = sizes.get("large");',
      'console.log(missing === undefined, typeof missing, sizes.get("small") + 1, missing ?? 0.5);',
    ],
  ],
  [
    "map-get-or-insert-answers-the-old-or-the-new-value",
    ["Map.prototype.getOrInsert"],
    [
      'const sizes = new Map([["small", 1.5]]);',
      'console.log(sizes.getOrInsert("small", "new") + 1, sizes.getOrInsert("large", "new").length, sizes.get("large").length);',
    ],
  ],
  [
    "map-get-or-insert-computed-runs-the-callback-for-a-missing-key",
    ["Map.prototype.getOrInsertComputed"],
    [
      'const sizes = new Map([["small", 1.5]]);',
      'console.log(sizes.getOrInsertComputed("large", key => key.length + 0.5) + 1, sizes.get("large") + 1);',
    ],
  ],
  [
    "weak-map-get-of-a-missing-key-answers-undefined",
    ["WeakMap.prototype.get"],
    [
      "const key = {};",
      "const notes = new WeakMap([[key, 1.5]]);",
      "const missing = notes.get({});",
      "console.log(missing === undefined, typeof missing, notes.get(key) + 1);",
    ],
  ],
  [
    "a-map-is-read-by-its-iterators",
    ["Map.prototype.keys", "Map.prototype.values", "Map.prototype.entries", "%MapIterator%.prototype.next"],
    [
      'const sizes = new Map([["small", 1.5], ["large", "huge"]]);',
      "console.log([...sizes.keys()].join(), [...sizes.values()].map(each => typeof each).join());",
      "const step = sizes.entries().next();",
      "console.log(step.value[0].length, step.value[1] + 1);",
    ],
  ],
  [
    "a-map-made-from-another-map-holds-its-values",
    ["Map"],
    [
      'const copy = new Map(new Map([["small", 1.5], ["large", "huge"]]));',
      'console.log(copy.size, copy.get("small") + 1, copy.get("large").length);',
    ],
  ],
  [
    "a-set-made-from-a-string-holds-its-characters",
    ["Set"],
    ['const letters = new Set("aab");', 'console.log(letters.size, letters.has("b"), [...letters][0].length);'],
  ],
  [
    "set-union-and-its-kin-hold-values-of-both-sets",
    [
      "Set.prototype.union",
      "Set.prototype.intersection",
      "Set.prototype.difference",
      "Set.prototype.symmetricDifference",
    ],
    [
      'const left = new Set([1.5, "two"]);',
      'const right = new Set(["two", { three: 3 }]);',
      "console.log([...left.union(right)][2].three + 1, [...left.intersection(right)][0].length);",
      "console.log([...left.difference(right)][0] + 1, [...left.symmetricDifference(right)][1].three + 1);",
    ],
  ],
  [
    "reg-exp-exec-has-undefined-for-a-group-that-did-not-take-part",
    ["RegExp.prototype.exec"],
    [
      'const match = /(?<year>\\d+)(?<suffix>x)?/.exec("in 2026");',
      "console.log(match[1].length, match[2] === undefined, typeof match[2], match.index + 1);",
      "console.log(match.groups.year.length, match.groups.suffix === undefined, typeof match.groups.suffix, match.groups.suffix ?? 0.5);",
    ],
  ],
  [
    "reg-exp-exec-without-named-groups-has-no-groups",
    ["RegExp.prototype.exec"],
    [
      'const match = /(a)/.exec("banana");',
      "console.log(match.groups === undefined, typeof match.groups, match.input.length, match.length);",
    ],
  ],
  [
    "reg-exp-exec-without-a-match-answers-null",
    ["RegExp.prototype.exec"],
    ['const match = /x/.exec("banana");', "console.log(match === null, typeof match, match?.index);"],
  ],
  [
    "reg-exp-exec-with-indices-has-undefined-for-a-group-that-did-not-take-part",
    ["RegExp.prototype.exec"],
    [
      'const match = /(?<first>a)(?<other>x)?/d.exec("banana");',
      "console.log(match.indices[0][0] + 1, match.indices[2] === undefined, match.indices.groups.first[1] + 1, match.indices.groups.other === undefined);",
    ],
  ],
  [
    "string-match-has-undefined-for-a-group-that-did-not-take-part",
    ["String.prototype.match"],
    [
      'const match = "in 2026".match(/(?<year>\\d+)(?<suffix>x)?/);',
      "console.log(match[2] === undefined, match.groups.suffix === undefined, match.groups.year.length);",
    ],
  ],
  [
    "string-match-without-a-match-answers-null",
    ["String.prototype.match"],
    ['const match = "banana".match(/x/g);', "console.log(match === null, match?.length, (match ?? []).length);"],
  ],
  [
    "string-match-with-the-global-flag-answers-a-list-of-strings",
    ["String.prototype.match"],
    [
      'const match = "banana".match(/an/g);',
      "console.log(match.length, match[1].length, match.index === undefined, match.groups === undefined);",
    ],
  ],
  [
    "string-match-all-has-undefined-for-a-group-that-did-not-take-part",
    ["String.prototype.matchAll", "%RegExpStringIterator%.prototype.next"],
    [
      'for (const match of "a1b".matchAll(/(?<letter>[a-z])(?<digit>\\d)?/g)) {',
      "  console.log(match.groups.letter.length, typeof match.groups.digit, match[2] === undefined, match.index + 1);",
      "}",
    ],
  ],
  [
    "string-replace-passes-undefined-for-a-group-that-did-not-take-part",
    ["String.prototype.replace"],
    [
      'console.log("a1b".replace(/([a-z])(\\d)?/g, (whole, letter, digit, offset, text) => {',
      "  console.log(typeof whole, typeof letter, typeof digit, digit === undefined, offset + 1, text.length);",
      '  return "-";',
      "}));",
    ],
  ],
  [
    "string-replace-passes-the-named-groups-last",
    ["String.prototype.replace"],
    [
      'console.log("a1b".replace(/(?<letter>[a-z])(?<digit>\\d)?/g, (whole, letter, digit, offset, text, groups) => {',
      "  console.log(typeof groups, groups.letter.length, typeof groups.digit);",
      "  return groups.letter.toUpperCase();",
      "}));",
    ],
  ],
  [
    "string-split-with-a-capturing-pattern-has-undefined-parts",
    ["String.prototype.split"],
    [
      'const parts = "a-b".split(/(-)|(x)/);',
      "console.log(parts.length, parts[1].length, parts[2] === undefined, typeof parts[2], parts[3].length);",
    ],
  ],
  [
    "string-at-and-char-at-past-the-end",
    ["String.prototype.at", "String.prototype.charAt", "String.prototype.charCodeAt", "String.prototype.codePointAt"],
    [
      'const text = "ab";',
      "console.log(text.at(5) === undefined, text.charAt(5).length, text.charCodeAt(5), text.codePointAt(5) === undefined, text[5] === undefined);",
    ],
  ],
  [
    "the-legacy-members-of-reg-exp-hold-the-last-match",
    ["RegExp.$1", "RegExp.lastMatch", "RegExp.leftContext"],
    [
      '/(n)(a)/.exec("banana");',
      "console.log(RegExp.$1.length, RegExp.$2, RegExp.$3.length, RegExp.lastMatch, RegExp.leftContext, RegExp.rightContext, RegExp.input.length);",
    ],
  ],
  [
    "json-parse-is-read-by-name-and-index",
    ["JSON.parse"],
    [
      'const data = JSON.parse(\'{ "first": 1.5, "list": ["two", null, { "three": 3 }], "none": null }\');',
      "console.log(data.first + 1, data.list.length, data.list[0].length, data.list[1] === null, data.list[2].three + 1, data.none === null, data.missing === undefined);",
    ],
  ],
  [
    "json-parse-of-each-kind-of-text",
    ["JSON.parse"],
    [
      'console.log(JSON.parse("1.5") + 1, JSON.parse(\'"two"\').length, JSON.parse("null") === null, JSON.parse("true") === true, JSON.parse("[]").length, Object.keys(JSON.parse("{}")).length);',
    ],
  ],
  [
    "json-parse-of-bad-text-throws-a-syntax-error",
    ["JSON.parse"],
    [
      "try {",
      '  JSON.parse("{ bad");',
      "} catch (error) {",
      "  console.log(error instanceof SyntaxError, typeof error.message);",
      "}",
    ],
  ],
  [
    "json-stringify-answers-undefined-for-what-it-cannot-write",
    ["JSON.stringify"],
    [
      "const nothing = JSON.stringify(undefined);",
      "console.log(nothing === undefined, typeof nothing, JSON.stringify(() => {}) === undefined, JSON.stringify(Symbol.iterator) === undefined, JSON.stringify(null).length);",
    ],
  ],
  [
    "structured-clone-is-read-by-name-and-index",
    ["structuredClone"],
    [
      'const copy = structuredClone({ first: 1.5, list: ["two", { three: 3 }], when: new Date(5), map: new Map([["key", 2.5]]) });',
      'console.log(copy.first + 1, copy.list[0].length, copy.list[1].three + 1, copy.when.getTime() + 1, copy.map.get("key") + 1);',
    ],
  ],
  [
    "structured-clone-of-an-instance-is-a-plain-object",
    ["structuredClone"],
    [
      "class Point {",
      "  x = 1.5;",
      "  double() {",
      "    return this.x * 2;",
      "  }",
      "}",
      "const copy = structuredClone(new Point());",
      "console.log(copy.x + 1, copy instanceof Point, typeof copy.double, Object.getPrototypeOf(copy) === Object.prototype);",
    ],
  ],
  [
    "structured-clone-keeps-two-references-to-one-object",
    ["structuredClone"],
    [
      "const shared = { value: 1.5 };",
      "const copy = structuredClone({ left: shared, right: shared });",
      'copy.left.value = "text";',
      "console.log(copy.left === copy.right, copy.right.value.length, shared.value + 1);",
    ],
  ],
  [
    "promise-all-settles-with-a-list",
    ["Promise.all"],
    [
      'const list = await Promise.all([1.5, Promise.resolve("two"), { three: 3 }]);',
      "console.log(list.length, list[0] + 1, list[1].length, list[2].three + 1);",
    ],
  ],
  [
    "promise-all-settled-settles-with-a-list-of-outcomes",
    ["Promise.allSettled"],
    [
      'const list = await Promise.allSettled([Promise.resolve(1.5), Promise.reject({ code: 2.5 }), "three"]);',
      "console.log(list[0].status, list[0].value + 1, list[0].reason === undefined, list[1].status, list[1].reason.code + 1, list[1].value === undefined, list[2].value.length);",
    ],
  ],
  [
    "promise-any-settles-with-the-first-value",
    ["Promise.any"],
    ['console.log((await Promise.any([Promise.reject(0), Promise.resolve("two")])).length);'],
  ],
  [
    "promise-any-rejects-with-an-aggregate-error",
    ["Promise.any", "AggregateError"],
    [
      "try {",
      '  await Promise.any([Promise.reject({ code: 1.5 }), Promise.reject("two")]);',
      "} catch (error) {",
      "  console.log(error instanceof AggregateError, error.errors.length, error.errors[0].code + 1, error.errors[1].length);",
      "}",
    ],
  ],
  [
    "promise-race-settles-with-the-first-value",
    ["Promise.race"],
    ['console.log((await Promise.race([new Promise(() => {}), Promise.resolve("two")])).length);'],
  ],
  [
    "promise-with-resolvers-settles-with-what-resolve-is-given",
    ["Promise.withResolvers"],
    [
      "const { promise, resolve, reject } = Promise.withResolvers();",
      "resolve({ size: 1.5 });",
      "console.log((await promise).size + 1, typeof reject);",
    ],
  ],
  [
    "promise-with-resolvers-rejects-with-what-reject-is-given",
    ["Promise.withResolvers"],
    [
      "const { promise, reject } = Promise.withResolvers();",
      "reject({ code: 1.5 });",
      "try {",
      "  await promise;",
      "} catch (error) {",
      "  console.log(error.code + 1);",
      "}",
    ],
  ],
  [
    "promise-reject-reaches-a-catch-block",
    ["Promise.reject"],
    [
      "try {",
      "  await Promise.reject({ code: 1.5 });",
      "} catch (error) {",
      "  console.log(typeof error, error.code + 1);",
      "}",
    ],
  ],
  [
    "promise-reject-reaches-a-catch-callback",
    ["Promise.reject", "Promise.prototype.catch"],
    ["console.log(await Promise.reject({ code: 1.5 }).catch(error => error.code + 1));"],
  ],
  [
    "promise-finally-lets-the-value-through",
    ["Promise.prototype.finally"],
    [
      'let state = "open";',
      "const value = await Promise.resolve({ size: 1.5 }).finally(() => {",
      "  state = 0.5;",
      '  return "ignored";',
      "});",
      "console.log(value.size + 1, typeof state, state + 1);",
    ],
  ],
  [
    "promise-finally-lets-the-reason-through",
    ["Promise.prototype.finally"],
    [
      "try {",
      "  await Promise.reject({ code: 1.5 }).finally(() => {});",
      "} catch (error) {",
      "  console.log(error.code + 1);",
      "}",
    ],
  ],
  [
    "promise-finally-rejects-with-what-its-callback-throws",
    ["Promise.prototype.finally"],
    [
      "try {",
      "  await Promise.resolve(1).finally(() => {",
      "    throw { code: 1.5 };",
      "  });",
      "} catch (error) {",
      "  console.log(error.code + 1);",
      "}",
    ],
  ],
  [
    "promise-then-without-a-callback-lets-the-value-through",
    ["Promise.prototype.then"],
    [
      "console.log((await Promise.resolve({ size: 1.5 }).then()).size + 1, (await Promise.resolve({ size: 2.5 }).then(null, () => 0)).size + 1);",
    ],
  ],
  [
    "promise-then-settles-with-what-its-callback-throws",
    ["Promise.prototype.then"],
    [
      "try {",
      "  await Promise.resolve(1).then(() => {",
      "    throw { code: 1.5 };",
      "  });",
      "} catch (error) {",
      "  console.log(error.code + 1);",
      "}",
    ],
  ],
  [
    "the-executor-of-a-promise-that-throws-rejects-it",
    ["Promise"],
    [
      "try {",
      "  await new Promise(() => {",
      "    throw { code: 1.5 };",
      "  });",
      "} catch (error) {",
      "  console.log(error.code + 1);",
      "}",
    ],
  ],
  [
    "the-resolve-function-kept-in-a-variable-settles-the-promise-later",
    ["Promise"],
    [
      "let settle;",
      "const promise = new Promise(resolve => {",
      "  settle = resolve;",
      "});",
      "settle({ size: 1.5 });",
      "console.log((await promise).size + 1);",
    ],
  ],
  [
    "bun-peek-answers-the-value-of-a-settled-promise",
    ["Bun.peek"],
    [
      "const promise = Promise.resolve({ size: 1.5 });",
      "console.log(Bun.peek(promise).size + 1, Bun.peek(2.5) + 1, Bun.peek(new Promise(() => {})) instanceof Promise);",
    ],
  ],
  [
    "an-error-holds-its-cause",
    ["Error"],
    [
      'const error = new Error("failed", { cause: { code: 1.5 } });',
      'console.log(error.cause.code + 1, error.message.length, "cause" in new Error("plain"), new Error("plain").cause === undefined);',
    ],
  ],
  [
    "an-aggregate-error-holds-its-errors",
    ["AggregateError"],
    [
      'const error = new AggregateError([{ code: 1.5 }, "two"], "failed");',
      "console.log(error.errors.length, error.errors[0].code + 1, error.errors[1].length, error.message.length);",
    ],
  ],
  [
    "a-suppressed-error-holds-both-errors",
    ["SuppressedError"],
    [
      'const error = new SuppressedError({ code: 1.5 }, "two", "failed");',
      "console.log(error.error.code + 1, error.suppressed.length, error.message.length);",
    ],
  ],
  [
    "a-weak-ref-answers-its-target",
    ["WeakRef", "WeakRef.prototype.deref"],
    [
      "const target = { size: 1.5 };",
      "console.log(new WeakRef(target).deref().size + 1, new WeakRef(target).deref() === target);",
    ],
  ],
  [
    "symbol-for-and-key-for-agree",
    ["Symbol.for", "Symbol.keyFor"],
    [
      'const key = Symbol.for("shared");',
      'console.log(Symbol.keyFor(key).length, Symbol.keyFor(Symbol("own")) === undefined, Symbol.for("shared") === key, key.description.length);',
    ],
  ],
  [
    "a-symbol-without-a-description-has-undefined",
    ["Symbol.prototype.description"],
    ['console.log(Symbol().description === undefined, typeof Symbol().description, Symbol("").description.length);'],
  ],
  [
    "a-bound-function-has-a-name-and-a-length",
    ["Function.prototype.bind"],
    [
      "function work(first, second, third) {}",
      "const bound = work.bind(null, 1);",
      "console.log(bound.name, bound.length + 1, typeof bound.prototype);",
    ],
  ],
  [
    "proxy-revocable-answers-a-proxy-and-a-function",
    ["Proxy.revocable"],
    [
      "const { proxy, revoke } = Proxy.revocable({ size: 1.5 }, {});",
      "console.log(proxy.size + 1);",
      "revoke();",
      "try {",
      "  proxy.size;",
      "} catch (error) {",
      "  console.log(error instanceof TypeError);",
      "}",
    ],
  ],
  [
    "reflect-own-keys-lists-strings-and-symbols",
    ["Reflect.ownKeys"],
    [
      "const keys = Reflect.ownKeys({ first: 1, [Symbol.iterator]: 2, 0: 3 });",
      "console.log(keys.length, keys[0], keys[1].length, typeof keys[2], keys[2] === Symbol.iterator);",
    ],
  ],
  [
    "reflect-get-own-property-descriptor-of-a-missing-name-answers-undefined",
    ["Reflect.getOwnPropertyDescriptor", "Object.getOwnPropertyDescriptor"],
    [
      'const missing = Reflect.getOwnPropertyDescriptor({}, "name");',
      'console.log(missing === undefined, typeof missing, Object.getOwnPropertyDescriptor({}, "name") === undefined);',
    ],
  ],
  [
    "reflect-get-of-a-missing-name-answers-undefined",
    ["Reflect.get"],
    [
      'const missing = Reflect.get({ present: 1.5 }, "absent");',
      'console.log(missing === undefined, typeof missing, Reflect.get({ present: 1.5 }, "present") + 1);',
    ],
  ],
  [
    "object-get-prototype-of-answers-null-or-the-parent",
    ["Object.getPrototypeOf"],
    [
      "class Base {",
      "  size() {",
      "    return 1.5;",
      "  }",
      "}",
      "console.log(Object.getPrototypeOf(new Base()).size() + 1, Object.getPrototypeOf(Object.create(null)) === null, Object.getPrototypeOf(Object.prototype) === null);",
    ],
  ],
  [
    "get-store-answers-what-run-was-given",
    ["node:async_hooks.AsyncLocalStorage.prototype.getStore"],
    [
      'import { AsyncLocalStorage } from "node:async_hooks";',
      "const storage = new AsyncLocalStorage();",
      "console.log(storage.getStore() === undefined);",
      "storage.run({ size: 1.5 }, () => {",
      "  console.log(storage.getStore().size + 1);",
      "});",
    ],
  ],
  [
    "get-store-answers-what-run-was-given-after-an-await",
    ["node:async_hooks.AsyncLocalStorage.prototype.getStore"],
    [
      'import { AsyncLocalStorage } from "node:async_hooks";',
      "const storage = new AsyncLocalStorage();",
      "await storage.run({ size: 1.5 }, async () => {",
      "  await null;",
      "  console.log(storage.getStore().size + 1);",
      "});",
    ],
  ],
  [
    "a-timer-from-timers-promises-settles-with-its-value",
    ["node:timers/promises.setTimeout"],
    [
      'import { setImmediate, setTimeout } from "node:timers/promises";',
      'console.log((await setTimeout(1, { size: 1.5 })).size + 1, (await setImmediate("two")).length, (await setTimeout(1)) === undefined);',
    ],
  ],
  [
    "an-abort-signal-holds-the-reason",
    ["AbortSignal"],
    [
      "const controller = new AbortController();",
      "console.log(controller.signal.aborted, controller.signal.reason === undefined);",
      "controller.abort({ code: 1.5 });",
      "console.log(controller.signal.aborted, controller.signal.reason.code + 1);",
    ],
  ],
  [
    "an-abort-listener-runs-with-an-event",
    ["AbortSignal", "EventTarget"],
    [
      "const controller = new AbortController();",
      'controller.signal.addEventListener("abort", function (event) {',
      "  console.log(event.type, this === controller.signal, event.target.reason.length);",
      "});",
      'controller.abort("stop");',
    ],
  ],
  [
    "abort-signal-throw-if-aborted-throws-the-reason",
    ["AbortSignal"],
    [
      "try {",
      "  AbortSignal.abort({ code: 1.5 }).throwIfAborted();",
      "} catch (error) {",
      "  console.log(error.code + 1);",
      "}",
    ],
  ],
  [
    "an-event-target-runs-a-listener-with-the-event",
    ["EventTarget"],
    [
      "const target = new EventTarget();",
      'target.addEventListener("ready", function (event) {',
      "  console.log(event.type.length, this === target, event.detail.size + 1);",
      "});",
      'console.log(target.dispatchEvent(new CustomEvent("ready", { detail: { size: 1.5 } })));',
    ],
  ],
  [
    "an-event-target-runs-handle-event-of-an-object",
    ["EventTarget"],
    [
      "const target = new EventTarget();",
      "const listener = {",
      "  handleEvent(event) {",
      "    console.log(event.type.length, this === listener);",
      "  },",
      "};",
      'target.addEventListener("ready", listener);',
      'target.dispatchEvent(new Event("ready"));',
    ],
  ],
  [
    "a-subclass-of-event-reaches-the-listener",
    ["EventTarget"],
    [
      "class Sized extends Event {",
      "  size = 1.5;",
      "}",
      "const target = new EventTarget();",
      'target.addEventListener("ready", event => console.log(event instanceof Sized, event.size + 1));',
      'target.dispatchEvent(new Sized("ready"));',
    ],
  ],
  [
    "a-message-channel-carries-a-copy",
    ["MessageChannel"],
    [
      "const { port1, port2 } = new MessageChannel();",
      "port2.onmessage = event => {",
      "  console.log(event.data.size + 1, event.data.list[0].length);",
      "  port1.close();",
      "};",
      'port1.postMessage({ size: 1.5, list: ["two"] });',
    ],
  ],
  [
    "a-timeout-answers-an-object-with-methods",
    ["setTimeout", "%Timeout%.prototype.ref"],
    [
      "const timer = setTimeout(() => {}, 1);",
      "console.log(typeof timer, timer.hasRef(), timer.unref() === timer, timer.ref() === timer, typeof timer[Symbol.toPrimitive]());",
      "clearTimeout(timer);",
    ],
  ],
  [
    "refresh-of-a-timeout-runs-the-callback-once",
    ["%Timeout%.prototype.refresh"],
    [
      "let runs = 0;",
      "const timer = setTimeout(() => {",
      "  runs++;",
      "  console.log(runs);",
      "}, 1);",
      "console.log(timer.refresh() === timer);",
    ],
  ],
  [
    "clear-timeout-stops-the-callback",
    ["clearTimeout"],
    [
      'let state = "waiting";',
      "const timer = setTimeout(() => {",
      "  state = 0.5;",
      "}, 0);",
      "clearTimeout(timer);",
      "setTimeout(() => console.log(typeof state, state.length), 5);",
    ],
  ],
  [
    "process-hrtime-and-memory-usage-have-their-members",
    ["process.hrtime", "process.memoryUsage", "process.cpuUsage"],
    [
      "const time = process.hrtime();",
      "console.log(time.length, typeof time[0], typeof time[1], typeof process.hrtime.bigint());",
      "const memory = process.memoryUsage();",
      "console.log(typeof memory.rss, typeof memory.heapUsed, typeof process.memoryUsage.rss(), typeof process.cpuUsage().user);",
    ],
  ],
  [
    "process-argv-and-env-are-read",
    ["process.argv", "process.env"],
    [
      "console.log(Array.isArray(process.argv), typeof process.argv[0], process.argv[99] === undefined, typeof process.env, process.env.NO_SUCH_VARIABLE_HERE === undefined);",
    ],
  ],
  [
    "a-store-to-process-env-is-read-back-as-text",
    ["process.env"],
    [
      "process.env.MADE_HERE = 15;",
      "console.log(typeof process.env.MADE_HERE, process.env.MADE_HERE.length);",
      "delete process.env.MADE_HERE;",
      "console.log(process.env.MADE_HERE === undefined);",
    ],
  ],
  [
    "import-meta-has-its-members",
    ["%ImportMeta%.url", "%ImportMeta%.main", "%ImportMeta%.dir"],
    [
      "console.log(typeof import.meta.url, import.meta.main, typeof import.meta.dir, typeof import.meta.path, typeof import.meta.file, typeof import.meta.env);",
    ],
  ],
  [
    "buffer-from-and-to-string-round-trip",
    ["Buffer.from", "Buffer.prototype.toString"],
    [
      'const buffer = Buffer.from("héllo");',
      'console.log(buffer.length + 1, buffer[0] + 1, buffer[99] === undefined, buffer.toString().length, buffer.toString("hex").length, buffer.toString("base64"));',
    ],
  ],
  [
    "buffer-concat-joins-buffers",
    ["Buffer.concat"],
    [
      'const joined = Buffer.concat([Buffer.from("ab"), Buffer.from("c")]);',
      "console.log(joined.length + 1, joined[2] + 1, joined.toString());",
    ],
  ],
  [
    "buffer-to-json-has-a-list-of-bytes",
    ["Buffer.prototype.toJSON"],
    ['const data = Buffer.from("ab").toJSON();', "console.log(data.type, data.data.length, data.data[1] + 1);"],
  ],
  [
    "buffer-reads-answer-numbers-of-each-kind",
    [
      "Buffer.prototype.readInt8",
      "Buffer.prototype.readDoubleLE",
      "Buffer.prototype.readBigInt64LE",
      "Buffer.prototype.readUInt32BE",
    ],
    [
      "const buffer = Buffer.from([255, 255, 255, 255, 0, 0, 248, 63]);",
      "console.log(buffer.readInt8(0) + 1, buffer.readUInt32BE(0) + 1, buffer.readInt32LE(0) + 1, typeof buffer.readDoubleLE(0), buffer.readBigInt64LE(0) + 1n, buffer.readFloatLE(4) + 1);",
    ],
  ],
  [
    "a-read-past-the-end-of-a-buffer-throws-a-range-error",
    ["Buffer.prototype.readInt32LE"],
    [
      "try {",
      "  Buffer.alloc(2).readInt32LE(0);",
      "} catch (error) {",
      "  console.log(error instanceof RangeError, error.code);",
      "}",
    ],
  ],
  [
    "text-decoder-and-encoder-round-trip",
    ["TextEncoder.prototype.encode", "TextDecoder.prototype.decode"],
    [
      'const bytes = new TextEncoder().encode("héllo");',
      "console.log(bytes instanceof Uint8Array, bytes.length + 1, bytes[1] + 1, new TextDecoder().decode(bytes).length);",
    ],
  ],
  [
    "a-url-is-read-by-its-members",
    ["URL", "URL.prototype.searchParams"],
    [
      'const url = new URL("https://example.com:8080/a?first=1&second=two#part");',
      'console.log(url.port.length, url.searchParams.get("second").length, url.searchParams.get("missing") === null, url.hash, url.searchParams === url.searchParams);',
    ],
  ],
  [
    "url-parse-and-can-parse-of-bad-text",
    ["URL.parse", "URL.canParse"],
    [
      'console.log(URL.parse("not a url") === null, URL.canParse("not a url"), URL.parse("https://example.com/a").pathname.length);',
    ],
  ],
  [
    "a-store-to-search-params-changes-the-url",
    ["URLSearchParams.prototype.set"],
    [
      'const url = new URL("https://example.com/");',
      'url.searchParams.set("first", 1.5);',
      'console.log(url.href, typeof url.searchParams.get("first"));',
    ],
  ],
  [
    "headers-get-of-a-missing-name-answers-null",
    ["Headers.prototype.get"],
    [
      'const headers = new Headers({ first: "1" });',
      'console.log(headers.get("missing") === null, headers.get("FIRST").length, headers.has("first"), [...headers].length, [...headers][0][1].length);',
    ],
  ],
  [
    "a-response-is-read-as-json",
    ["Response.prototype.json", "Response.json"],
    [
      'const data = await Response.json({ first: 1.5, list: ["two"] }).json();',
      "console.log(data.first + 1, data.list[0].length, data.missing === undefined);",
    ],
  ],
  [
    "a-response-is-read-as-text-bytes-and-a-buffer",
    ["Response.prototype.text", "Response.prototype.bytes", "Response.prototype.arrayBuffer"],
    [
      'console.log((await new Response("abc").text()).length, (await new Response("abc").bytes())[0] + 1, (await new Response("abc").arrayBuffer()).byteLength + 1);',
    ],
  ],
  [
    "a-request-is-read-by-its-members",
    ["Request", "Request.prototype.json"],
    [
      'const request = new Request("https://example.com/a", { method: "POST", body: "[1.5]", headers: { first: "1" } });',
      'console.log(request.method.length, request.url.length, request.headers.get("first").length, (await request.json())[0] + 1, request.bodyUsed);',
    ],
  ],
  [
    "a-blob-is-read-as-text-and-sliced",
    ["Blob", "Blob.prototype.text", "Blob.prototype.slice"],
    [
      'const blob = new Blob(["ab", "cd"], { type: "text/plain" });',
      "console.log(blob.size + 1, blob.type.length, (await blob.text()).length, (await blob.slice(1, 3).text()).length);",
    ],
  ],
  [
    "form-data-get-of-a-missing-name-answers-null",
    ["FormData.prototype.get"],
    [
      "const form = new FormData();",
      'form.append("first", "1");',
      'console.log(form.get("first").length, form.get("missing") === null, form.getAll("first").length, form.has("first"));',
    ],
  ],
  [
    "bun-inspect-answers-text",
    ["Bun.inspect"],
    ['console.log(typeof Bun.inspect({ first: 1.5 }), Bun.inspect({ first: 1.5 }), Bun.inspect("two").length);'],
  ],
  [
    "bun-deep-equals-compares-contents",
    ["Bun.deepEquals"],
    ['console.log(Bun.deepEquals({ first: [1.5] }, { first: [1.5] }), Bun.deepEquals({ first: 1 }, { first: "1" }));'],
  ],
  [
    "bun-hash-answers-numbers-and-big-integers",
    ["Bun.hash", "Bun.hash.crc32", "Bun.hash.wyhash"],
    [
      'console.log(typeof Bun.hash("text"), typeof Bun.hash.crc32("text"), Bun.hash.crc32("text") + 1, typeof Bun.hash.wyhash("text"));',
    ],
  ],
  [
    "bun-escape-html-and-string-width-answer-text-and-a-number",
    ["Bun.escapeHTML", "Bun.stringWidth"],
    ['console.log(Bun.escapeHTML("<a>").length, Bun.escapeHTML(1.5), Bun.stringWidth("abc") + 1);'],
  ],
  [
    "gzip-and-gunzip-round-trip",
    ["Bun.gzipSync", "Bun.gunzipSync"],
    [
      'const bytes = Bun.gunzipSync(Bun.gzipSync("hello"));',
      "console.log(bytes instanceof Uint8Array, bytes.length + 1, bytes[0] + 1);",
    ],
  ],
  [
    "a-crypto-hasher-answers-text-and-bytes",
    ["Bun.CryptoHasher", "Bun.CryptoHasher.prototype.update"],
    [
      'const hasher = new Bun.CryptoHasher("sha256");',
      'console.log(hasher.update("a") === hasher, hasher.digest("hex").length, new Bun.CryptoHasher("md5").update("a").digest().length + 1);',
    ],
  ],
  ["atob-and-btoa-round-trip", ["atob", "btoa"], ['console.log(btoa("hi"), atob(btoa("hi")).length);']],
  [
    "number-and-string-conversions-answer-their-kinds",
    ["Number", "String", "Boolean", "BigInt", "parseInt", "parseFloat"],
    [
      'console.log(Number("1.5") + 1, Number("x"), String(1.5).length, Boolean("") === false, BigInt(5) + 1n, parseInt("12px") + 1, parseInt("x"), parseFloat("1.5x") + 1);',
    ],
  ],
  [
    "math-functions-answer-fractions-not-a-number-and-minus-zero",
    ["Math.round", "Math.max", "Math.min", "Math.sqrt", "Math.sign", "Math.trunc", "Math.ceil"],
    [
      "console.log(Object.is(Math.round(-0.2), -0), Math.max(), Math.min(), Math.sqrt(-1), Object.is(Math.sign(-0), -0), Object.is(Math.trunc(-0.5), -0), Object.is(Math.ceil(-0.5), -0), Math.max(1, NaN));",
    ],
  ],
  [
    "math-functions-of-large-numbers-leave-the-integers",
    ["Math.abs", "Math.imul", "Math.floor", "Math.pow", "Math.clz32"],
    [
      "console.log(Math.abs(-2147483648) + 1, Math.imul(65536, 65536), Math.floor(4294967296.5) + 1, Math.pow(2, 31) + 1, Math.clz32(0) + 1, Math.round(2147483647.5));",
    ],
  ],
  [
    "date-members-of-an-invalid-date-are-not-a-number",
    ["Date.prototype.getTime", "Date.prototype.getFullYear", "Date.prototype.toJSON"],
    [
      'const date = new Date("nonsense");',
      "console.log(date.getTime(), date.getFullYear(), date.getDay(), date.toJSON() === null, String(date));",
    ],
  ],
  [
    "date-setters-answer-the-new-time",
    ["Date.prototype.setTime", "Date.prototype.setUTCHours", "Date.prototype.setUTCFullYear"],
    [
      "const date = new Date(0);",
      "console.log(date.setTime(5.9) + 1, date.setUTCHours(1) + 1, date.setUTCFullYear(NaN), date.getTime());",
    ],
  ],
  [
    "number-methods-answer-text",
    [
      "Number.prototype.toFixed",
      "Number.prototype.toString",
      "Number.prototype.toPrecision",
      "Number.prototype.toExponential",
    ],
    [
      "console.log((1.005).toFixed(2).length, (255).toString(16), (1.5).toPrecision(3), (1500).toExponential(1), (0.1 + 0.2).toString().length);",
    ],
  ],
  [
    "typed-array-reads-past-the-end-answer-undefined",
    ["Uint8Array", "%TypedArray%.prototype.at"],
    [
      "const view = new Uint8Array([1, 2]);",
      "console.log(view[5] === undefined, view.at(5) === undefined, view.at(-1) + 1, view[-1] === undefined, typeof view[2]);",
    ],
  ],
  [
    "typed-array-find-without-a-match-answers-undefined",
    ["%TypedArray%.prototype.find", "%TypedArray%.prototype.findLast"],
    [
      "const view = new Float64Array([1.5, 2.5]);",
      "console.log(view.find(value => value > 9) === undefined, view.findLast(value => value > 9) === undefined, view.find(value => value > 2) + 1);",
    ],
  ],
  [
    "typed-array-from-and-of-hold-converted-numbers",
    ["%TypedArray%.from", "%TypedArray%.of"],
    [
      'console.log(Uint8Array.from([1.9, "2", 257]).join(), Float32Array.of(1.5, 2).join(), Int8Array.from({ length: 2 }, (value, index) => index * 200).join());',
    ],
  ],
  [
    "a-big-integer-array-holds-big-integers",
    ["BigInt64Array", "BigUint64Array"],
    [
      "const view = new BigInt64Array([1n, -1n]);",
      "console.log(typeof view[0], view[0] + 1n, new BigUint64Array(view.buffer)[1]);",
    ],
  ],
  [
    "data-view-reads-answer-numbers-of-each-kind",
    [
      "DataView.prototype.getInt8",
      "DataView.prototype.getUint32",
      "DataView.prototype.getFloat64",
      "DataView.prototype.getBigInt64",
    ],
    [
      "const view = new DataView(new Uint8Array([255, 255, 255, 255, 0, 0, 248, 63]).buffer);",
      "console.log(view.getInt8(0) + 1, view.getUint32(0) + 1, view.getInt32(0) + 1, typeof view.getFloat64(0, true), view.getBigInt64(0, true) + 1n, view.getFloat32(4, true) + 1);",
    ],
  ],
  [
    "iterator-helpers-answer-iterators-that-are-read",
    ["Iterator.prototype.map", "Iterator.prototype.take", "%IteratorHelper%.prototype.next"],
    [
      'const helper = [1.5, "two", { three: 3 }].values().map(value => [value]).drop(1).take(2);',
      "console.log(helper.next().value[0].length, helper.next().value[0].three + 1, helper.next().done, helper.next().value === undefined);",
    ],
  ],
  [
    "string-raw-and-a-template-join-their-parts",
    ["String.raw"],
    ['console.log(String.raw`a\\n${1.5}b`.length, String.raw({ raw: ["x", "y"] }, 2.5));'],
  ],
  [
    "string-methods-answer-lists-and-text",
    ["String.prototype.split", "String.prototype.concat", "String.prototype.padStart", "String.prototype.repeat"],
    [
      'const parts = "a,b".split(",");',
      'console.log(parts.length, parts[1].length, parts[2] === undefined, "a".concat(1.5, null).length, "a".padStart(3, "xy"), "ab".repeat(2).length);',
    ],
  ],
  [
    "a-string-iterator-answers-whole-characters",
    ["String.prototype[Symbol.iterator]", "%StringIterator%.prototype.next"],
    [
      'const steps = "a😀"[Symbol.iterator]();',
      "console.log(steps.next().value.length, steps.next().value.length, steps.next().value === undefined);",
    ],
  ],
  [
    "intl-formats-answer-text-and-parts",
    ["Intl.NumberFormat.prototype.format", "Intl.DateTimeFormat.prototype.format"],
    [
      'console.log(new Intl.NumberFormat("en-US").format(1234.5), new Intl.NumberFormat("en-US").formatToParts(1.5)[0].type, new Intl.DateTimeFormat("en-US", { timeZone: "UTC" }).format(0), new Intl.PluralRules("en-US").select(1));',
    ],
  ],
  [
    "an-intl-collator-compare-is-handed-to-sort",
    ["Intl.Collator.prototype.compare", "Array.prototype.sort"],
    ['console.log(["b", "a", "C"].sort(new Intl.Collator("en-US").compare).join());'],
  ],
  [
    "an-intl-segmenter-is-iterated",
    ["Intl.Segmenter.prototype.segment", "%IntlSegmentIterator%.prototype.next"],
    [
      'for (const part of new Intl.Segmenter("en-US", { granularity: "word" }).segment("a b")) console.log(part.segment.length, part.index + 1, part.isWordLike);',
    ],
  ],
];

export function resultPrograms(): Program[] {
  return programs.map(([name, rows, text]) => ({ name, rows, text: lines(text) }));
}
