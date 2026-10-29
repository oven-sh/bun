import { lines, type Program } from "./program";

interface Target {
  words: string;
  text: string[];
  next: string;
}

const targets: Target[] = [
  {
    words: "an-instance-with-a-field",
    text: [
      "class Box {",
      "  value = 1;",
      "  next() {",
      "    return this.value + 1;",
      "  }",
      "}",
      "const target = new Box();",
    ],
    next: "target.next()",
  },
  {
    words: "an-instance-whose-constructor-stores",
    text: [
      "class Box {",
      "  constructor(value) {",
      "    this.value = value;",
      "  }",
      "  next() {",
      "    return this.value + 1;",
      "  }",
      "}",
      "const target = new Box(1);",
    ],
    next: "target.next()",
  },
  {
    words: "a-literal",
    text: ["function next(box) {", "  return box.value + 1;", "}", "const target = { value: 1 };"],
    next: "next(target)",
  },
  {
    words: "an-object-made-by-a-constructor-function",
    text: [
      "function Box() {",
      "  this.value = 1;",
      "}",
      "Box.prototype.next = function () {",
      "  return this.value + 1;",
      "};",
      "const target = new Box();",
    ],
    next: "target.next()",
  },
];

interface Writer {
  words: string;
  rows: string[];
  text: string[];
  after?: (target: Target) => string[];
}

const usesText = (target: Target) => [`console.log(typeof target.value, target.value.length, ${target.next});`];

const writers: Writer[] = [
  {
    words: "object-assign-stores-text-from-a-literal-into",
    rows: ["Object.assign"],
    text: ['Object.assign(target, { value: "text" });'],
  },
  {
    words: "object-assign-stores-text-from-an-instance-into",
    rows: ["Object.assign"],
    text: ["class Source {", '  value = "text";', "}", "Object.assign(target, new Source());"],
  },
  {
    words: "object-assign-stores-what-a-getter-returns-into",
    rows: ["Object.assign"],
    text: ["const source = {", "  get value() {", '    return "text";', "  },", "};", "Object.assign(target, source);"],
  },
  {
    words: "object-assign-stores-text-from-its-third-operand-into",
    rows: ["Object.assign"],
    text: ['Object.assign(target, { other: 2 }, { value: "text" });'],
  },
  {
    words: "object-assign-adds-a-member-to",
    rows: ["Object.assign"],
    text: ['Object.assign(target, { added: "text" });'],
    after: target => [
      `console.log(typeof target.added, target.added.length, Object.keys(target).join(), ${target.next});`,
    ],
  },
  {
    words: "object-assign-answers-its-target-which-is",
    rows: ["Object.assign"],
    text: ['const answer = Object.assign(target, { value: "text" });'],
    after: () => ["console.log(answer === target, typeof answer.value, answer.value.length);"],
  },
  {
    words: "object-define-property-stores-text-into",
    rows: ["Object.defineProperty"],
    text: ['Object.defineProperty(target, "value", { value: "text" });'],
  },
  {
    words: "object-define-property-puts-a-getter-on",
    rows: ["Object.defineProperty"],
    text: ['Object.defineProperty(target, "value", {', "  get() {", '    return "text";', "  },", "});"],
  },
  {
    words: "object-define-property-puts-a-setter-on",
    rows: ["Object.defineProperty"],
    text: [
      'let stored = "nothing";',
      'Object.defineProperty(target, "value", {',
      "  get() {",
      "    return stored;",
      "  },",
      "  set(value) {",
      "    stored = `stored ${value}`;",
      "  },",
      "});",
      "target.value = 5;",
    ],
  },
  {
    words: "object-define-property-makes-read-only-the-member-of",
    rows: ["Object.defineProperty"],
    text: [
      'Object.defineProperty(target, "value", { writable: false });',
      "try {",
      "  target.value = 2;",
      "} catch (error) {",
      "  console.log(error instanceof TypeError);",
      "}",
    ],
    after: target => [`console.log(target.value, ${target.next});`],
  },
  {
    words: "object-define-property-with-a-descriptor-from-a-variable-stores-text-into",
    rows: ["Object.defineProperty"],
    text: ['const descriptor = { value: "text" };', 'Object.defineProperty(target, "value", descriptor);'],
  },
  {
    words: "object-define-property-with-a-computed-key-stores-text-into",
    rows: ["Object.defineProperty"],
    text: ['const key = ["val", "ue"].join("");', 'Object.defineProperty(target, key, { value: "text" });'],
  },
  {
    words: "object-define-properties-stores-text-into",
    rows: ["Object.defineProperties"],
    text: ['Object.defineProperties(target, { value: { value: "text" } });'],
  },
  {
    words: "object-define-properties-puts-a-getter-on",
    rows: ["Object.defineProperties"],
    text: [
      "Object.defineProperties(target, {",
      "  value: {",
      "    get() {",
      '      return "text";',
      "    },",
      "  },",
      "});",
    ],
  },
  { words: "reflect-set-stores-text-into", rows: ["Reflect.set"], text: ['Reflect.set(target, "value", "text");'] },
  {
    words: "reflect-set-with-a-receiver-stores-text-into",
    rows: ["Reflect.set"],
    text: ['Reflect.set({}, "value", "text", target);'],
  },
  {
    words: "reflect-set-with-a-computed-key-stores-text-into",
    rows: ["Reflect.set"],
    text: ['const key = ["val", "ue"].join("");', 'Reflect.set(target, key, "text");'],
  },
  {
    words: "reflect-define-property-stores-text-into",
    rows: ["Reflect.defineProperty"],
    text: ['Reflect.defineProperty(target, "value", { value: "text" });'],
  },
  {
    words: "define-getter-puts-a-getter-on",
    rows: ["Object.prototype.__defineGetter__"],
    text: ['target.__defineGetter__("value", () => "text");'],
  },
  {
    words: "define-setter-puts-a-setter-on",
    rows: ["Object.prototype.__defineSetter__"],
    text: [
      'let stored = "nothing";',
      'target.__defineSetter__("value", value => {',
      "  stored = `stored ${value}`;",
      "});",
      "target.value = 5;",
    ],
    after: target => [`console.log(stored, target.value === undefined, ${target.next});`],
  },
  {
    words: "reflect-delete-property-removes-the-member-of",
    rows: ["Reflect.deleteProperty"],
    text: ['console.log(Reflect.deleteProperty(target, "value"));'],
    after: target => [
      `console.log(target.value === undefined, "value" in target, Object.keys(target).length, ${target.next});`,
    ],
  },
  {
    words: "object-set-prototype-of-gives-another-parent-to",
    rows: ["Object.setPrototypeOf"],
    text: ['Object.setPrototypeOf(target, { extra: "text" });'],
    after: () => ["console.log(typeof target.extra, target.extra.length, typeof target.next, target.value + 1);"],
  },
  {
    words: "reflect-set-prototype-of-gives-another-parent-to",
    rows: ["Reflect.setPrototypeOf"],
    text: ['Reflect.setPrototypeOf(target, { extra: "text" });'],
    after: () => ["console.log(typeof target.extra, target.extra.length, typeof target.next, target.value + 1);"],
  },
  {
    words: "a-store-to-proto-gives-another-parent-to",
    rows: ["Object.prototype.__proto__"],
    text: ['target.__proto__ = { extra: "text" };'],
    after: () => ["console.log(typeof target.extra, target.extra.length, typeof target.next, target.value + 1);"],
  },
  {
    words: "object-set-prototype-of-takes-the-parent-from",
    rows: ["Object.setPrototypeOf"],
    text: ["Object.setPrototypeOf(target, null);"],
    after: () => ["console.log(typeof target.next, typeof target.toString, target.value + 1);"],
  },
  {
    words: "object-freeze-stops-a-store-into",
    rows: ["Object.freeze"],
    text: [
      "Object.freeze(target);",
      "try {",
      "  target.value = 2;",
      "} catch (error) {",
      "  console.log(error instanceof TypeError);",
      "}",
    ],
    after: target => [`console.log(target.value, ${target.next}, Object.isFrozen(target));`],
  },
  {
    words: "object-seal-stops-a-delete-from",
    rows: ["Object.seal"],
    text: [
      "Object.seal(target);",
      "try {",
      "  delete target.value;",
      "} catch (error) {",
      "  console.log(error instanceof TypeError);",
      "}",
    ],
    after: target => [`console.log(target.value, ${target.next});`],
  },
  {
    words: "object-prevent-extensions-stops-a-new-member-of",
    rows: ["Object.preventExtensions"],
    text: [
      "Object.preventExtensions(target);",
      "try {",
      "  target.added = 2;",
      "} catch (error) {",
      "  console.log(error instanceof TypeError);",
      "}",
    ],
    after: target => [`console.log(target.added === undefined, Object.keys(target).join(), ${target.next});`],
  },
  {
    words: "a-key-from-object-keys-is-used-to-store-text-into",
    rows: ["Object.keys"],
    text: ['for (const key of Object.keys(target)) target[key] = "text";'],
  },
  {
    words: "a-key-from-reflect-own-keys-is-used-to-store-text-into",
    rows: ["Reflect.ownKeys"],
    text: ['for (const key of Reflect.ownKeys(target)) target[key] = "text";'],
  },
  {
    words: "a-key-from-object-entries-is-used-to-store-text-into",
    rows: ["Object.entries"],
    text: ["for (const [key, value] of Object.entries(target)) target[key] = `text ${value}`;"],
  },
  {
    words: "a-key-from-object-get-own-property-names-is-used-to-store-text-into",
    rows: ["Object.getOwnPropertyNames"],
    text: ['for (const key of Object.getOwnPropertyNames(target)) target[key] = "text";'],
  },
  {
    words: "array-push-called-on-it-adds-an-element-and-a-length-to",
    rows: ["Array.prototype.push"],
    text: ["target.push = Array.prototype.push;", 'target.push("text");'],
    after: target => [`console.log(target.length, typeof target[0], target[0].length, ${target.next});`],
  },
  {
    words: "structured-clone-copies",
    rows: ["structuredClone"],
    text: ["const copy = structuredClone(target);"],
    after: () => ["console.log(copy === target, copy.value + 1, typeof copy.next, Object.keys(copy).join());"],
  },
  {
    words: "object-create-makes-an-heir-of",
    rows: ["Object.create"],
    text: ['const heir = Object.create(target, { added: { value: "text", enumerable: true } });'],
    after: () => [
      "console.log(heir.value + 1, heir.added.length, Object.keys(heir).join(), Object.getPrototypeOf(heir) === target);",
    ],
  },
  {
    words: "object-get-own-property-descriptor-describes-the-member-of",
    rows: ["Object.getOwnPropertyDescriptor"],
    text: ['const descriptor = Object.getOwnPropertyDescriptor(target, "value");'],
    after: () => [
      "console.log(descriptor.value + 1, descriptor.writable, descriptor.enumerable, descriptor.get === undefined);",
    ],
  },
  {
    words: "object-values-lists-the-member-of",
    rows: ["Object.values"],
    text: ["const values = Object.values(target);"],
    after: () => ["console.log(values.length, typeof values[0], values[0] + 1);"],
  },
  {
    words: "json-stringify-writes",
    rows: ["JSON.stringify"],
    text: ["const written = JSON.stringify(target);"],
    after: () => ["console.log(typeof written, written.length, written);"],
  },
];

interface ListWriter {
  words: string;
  rows: string[];
  text: string[];
  after: string[];
  list?: string;
}

const sum = ["let total = 0;", "for (const each of list) total += each;", "console.log(total);"];
const kinds = "console.log(list.length, list.map(each => typeof each).join());";

const listWriters: ListWriter[] = [
  {
    words: "array-fill-stores-text-in",
    rows: ["Array.prototype.fill"],
    text: ['list.fill("text");'],
    after: [kinds, "console.log(list[0].length);", ...sum],
  },
  {
    words: "array-fill-stores-text-in-a-part-of",
    rows: ["Array.prototype.fill"],
    text: ['list.fill("text", 1, 2);'],
    after: [kinds, "console.log(list[0] + 1, list[1].length);", ...sum],
  },
  {
    words: "array-fill-stores-a-fraction-in",
    rows: ["Array.prototype.fill"],
    text: ["list.fill(0.5, 1);"],
    after: [kinds, "console.log(list[0] + 1, list[1] + 1);", ...sum],
  },
  {
    words: "array-fill-stores-undefined-in",
    rows: ["Array.prototype.fill"],
    text: ["list.fill(undefined, 2);"],
    after: [kinds, "console.log(list[2] === undefined, 2 in list);", ...sum],
  },
  {
    words: "array-push-adds-text-to",
    rows: ["Array.prototype.push"],
    text: ['list.push("text");'],
    after: [kinds, "console.log(list[3].length);", ...sum],
  },
  {
    words: "array-push-adds-a-fraction-to",
    rows: ["Array.prototype.push"],
    text: ["list.push(0.5);"],
    after: [kinds, "console.log(list[3] + 1);", ...sum],
  },
  {
    words: "array-push-adds-three-kinds-to",
    rows: ["Array.prototype.push"],
    text: ['list.push(0.5, "text", null);'],
    after: [kinds, "console.log(list[3] + 1, list[4].length, list[5] === null);"],
  },
  {
    words: "array-unshift-adds-text-to",
    rows: ["Array.prototype.unshift"],
    text: ['list.unshift("text");'],
    after: [kinds, "console.log(list[0].length, list[1] + 1);", ...sum],
  },
  {
    words: "array-splice-puts-text-in",
    rows: ["Array.prototype.splice"],
    text: ['const removed = list.splice(1, 1, "text", "more");'],
    after: [kinds, "console.log(removed.length, removed[0] + 1, list[1].length);", ...sum],
  },
  {
    words: "array-splice-removes-everything-from",
    rows: ["Array.prototype.splice"],
    text: ["const removed = list.splice(0);"],
    after: [kinds, "console.log(removed.length, removed[2] + 1, list[0] === undefined);"],
  },
  {
    words: "array-copy-within-moves-a-hole-in",
    rows: ["Array.prototype.copyWithin"],
    list: "[1, 2, , 4]",
    text: ["list.copyWithin(0, 2);"],
    after: ["console.log(list.length, 0 in list, list[0] === undefined, list[1] + 1);"],
  },
  {
    words: "array-reverse-moves-a-hole-in",
    rows: ["Array.prototype.reverse"],
    list: "[1, 2, , 4]",
    text: ["list.reverse();"],
    after: ["console.log(list.length, 1 in list, list[1] === undefined, list[0] + 1);"],
  },
  {
    words: "array-sort-moves-a-hole-and-undefined-in",
    rows: ["Array.prototype.sort"],
    list: "[3, undefined, , 1]",
    text: ["list.sort();"],
    after: ["console.log(list.length, list[0] + 1, list[2] === undefined, 2 in list, 3 in list);"],
  },
  {
    words: "array-pop-empties",
    rows: ["Array.prototype.pop"],
    text: ["list.pop();", "list.pop();", "list.pop();", "const last = list.pop();"],
    after: ["console.log(list.length, last === undefined, typeof last, list[0] === undefined);"],
  },
  {
    words: "array-shift-empties",
    rows: ["Array.prototype.shift"],
    text: ["list.shift();", "list.shift();", "list.shift();", "const first = list.shift();"],
    after: ["console.log(list.length, first === undefined, typeof first, list[0] === undefined);"],
  },
  {
    words: "object-assign-stores-text-in",
    rows: ["Object.assign"],
    text: ['Object.assign(list, ["text"]);'],
    after: [kinds, "console.log(list[0].length, list[1] + 1);", ...sum],
  },
  {
    words: "object-assign-stores-text-past-the-end-of",
    rows: ["Object.assign"],
    text: ['Object.assign(list, { 5: "text" });'],
    after: ["console.log(list.length, 4 in list, list[4] === undefined, list[5].length);"],
  },
  {
    words: "reflect-set-stores-text-in",
    rows: ["Reflect.set"],
    text: ['Reflect.set(list, 0, "text");'],
    after: [kinds, "console.log(list[0].length);", ...sum],
  },
  {
    words: "reflect-set-changes-the-length-of",
    rows: ["Reflect.set"],
    text: ['Reflect.set(list, "length", 5);'],
    after: [
      "console.log(list.length, 4 in list, list[4] === undefined);",
      "console.log(list.findIndex(each => each === undefined));",
    ],
  },
  {
    words: "reflect-set-shortens",
    rows: ["Reflect.set"],
    text: ['Reflect.set(list, "length", 1);'],
    after: ["console.log(list.length, list[1] === undefined, list[0] + 1);", ...sum],
  },
  {
    words: "object-define-property-stores-text-in",
    rows: ["Object.defineProperty"],
    text: ['Object.defineProperty(list, 0, { value: "text" });'],
    after: [kinds, "console.log(list[0].length);", ...sum],
  },
  {
    words: "object-define-property-puts-a-getter-in",
    rows: ["Object.defineProperty"],
    text: ["Object.defineProperty(list, 1, {", "  get() {", '    return "text";', "  },", "});"],
    after: [kinds, "console.log(list[1].length);", ...sum],
  },
  {
    words: "object-define-property-changes-the-length-of",
    rows: ["Object.defineProperty"],
    text: ['Object.defineProperty(list, "length", { value: 5 });'],
    after: [
      "console.log(list.length, 4 in list, list[4] === undefined);",
      "console.log(list.findIndex(each => each === undefined));",
    ],
  },
  {
    words: "reflect-delete-property-makes-a-hole-in",
    rows: ["Reflect.deleteProperty"],
    text: ["Reflect.deleteProperty(list, 1);"],
    after: [
      "console.log(list.length, 1 in list, list[1] === undefined);",
      "console.log(list.findIndex(each => each === undefined));",
      ...sum,
    ],
  },
  {
    words: "object-freeze-stops-a-push-into",
    rows: ["Object.freeze"],
    text: [
      "Object.freeze(list);",
      "try {",
      "  list.push(4);",
      "} catch (error) {",
      "  console.log(error instanceof TypeError);",
      "}",
    ],
    after: ["console.log(list.length, list[2] + 1);"],
  },
  {
    words: "object-set-prototype-of-gives-inherited-elements-to",
    rows: ["Object.setPrototypeOf"],
    list: "[1, , 3]",
    text: ['Object.setPrototypeOf(list, { 1: "text", __proto__: Array.prototype });'],
    after: [
      "console.log(list.length, 1 in list, typeof list[1], list[1].length);",
      "console.log(list.map(each => typeof each).join());",
    ],
  },
  {
    words: "array-with-copies-text-into-a-copy-of",
    rows: ["Array.prototype.with"],
    text: ['const copy = list.with(1, "text");'],
    after: ["console.log(copy[1].length, list[1] + 1, copy === list);"],
  },
  {
    words: "array-to-spliced-copies-text-into-a-copy-of",
    rows: ["Array.prototype.toSpliced"],
    text: ['const copy = list.toSpliced(1, 1, "text");'],
    after: ["console.log(copy[1].length, list[1] + 1, copy.length);"],
  },
  {
    words: "array-concat-joins-text-to-a-copy-of",
    rows: ["Array.prototype.concat"],
    text: ['const copy = list.concat("text", ["more"]);'],
    after: ["console.log(copy.length, copy[0] + 1, copy[3].length, copy[4].length, list.length);"],
  },
  {
    words: "array-flat-opens-lists-of-text-in",
    rows: ["Array.prototype.flat"],
    list: '[1, ["text"], [[2.5]]]',
    text: ["const flat = list.flat();"],
    after: ["console.log(flat.length, flat[0] + 1, flat[1].length, Array.isArray(flat[2]), flat[2][0] + 1);"],
  },
  {
    words: "array-from-with-a-receiver-fills-an-instance-from",
    rows: ["Array.from"],
    text: ["class Holder {", "  length = 0;", "}", "const holder = Array.from.call(Holder, list);"],
    after: ["console.log(holder instanceof Holder, holder.length, holder[0] + 1, Object.keys(holder).join());"],
  },
  {
    words: "array-of-with-a-receiver-fills-an-instance-beside",
    rows: ["Array.of"],
    text: ["class Holder {", "  length = 0;", "}", 'const holder = Array.of.call(Holder, list[0], "text");'],
    after: ["console.log(holder instanceof Holder, holder.length, holder[0] + 1, holder[1].length);"],
  },
];

const bytes: [string, string[], string[]][] = [
  [
    "typed-array-set-copies-fractions-into-integers",
    ["%TypedArray%.prototype.set"],
    [
      "const view = new Int32Array(3);",
      "view.set([1.5, -2.5, 300.75]);",
      "console.log(view[0] + 1, view[1] + 1, view[2] + 1);",
    ],
  ],
  [
    "typed-array-set-copies-large-numbers-into-bytes",
    ["%TypedArray%.prototype.set"],
    ["const view = new Uint8Array(3);", "view.set([256, -1, 1.9], 0);", "console.log(view[0], view[1], view[2]);"],
  ],
  [
    "typed-array-set-copies-from-an-array-like-object",
    ["%TypedArray%.prototype.set"],
    [
      "const view = new Float64Array(3);",
      'view.set({ length: 2, 0: 1.5, 1: "2.5" }, 1);',
      "console.log(view[0], view[1] + 1, view[2] + 1);",
    ],
  ],
  [
    "typed-array-fill-stores-a-fraction-in-integers",
    ["%TypedArray%.prototype.fill"],
    ["const view = new Int16Array(2);", "view.fill(1.75);", "console.log(view[0] + 1, view[1] + 1);"],
  ],
  [
    "typed-array-fill-stores-not-a-number-in-floats",
    ["%TypedArray%.prototype.fill"],
    [
      "const view = new Float32Array(2);",
      "view.fill(undefined);",
      "console.log(view[0], typeof view[0], view[1] + 1);",
    ],
  ],
  [
    "two-views-of-one-buffer-see-each-others-stores",
    ["Float64Array", "Uint8Array"],
    [
      "const buffer = new ArrayBuffer(8);",
      "const floats = new Float64Array(buffer);",
      "const view = new Uint8Array(buffer);",
      "console.log(view[7]);",
      "floats[0] = 1.5;",
      "console.log(view[7], view[6]);",
      "view[7] = 64;",
      "console.log(floats[0]);",
    ],
  ],
  [
    "a-data-view-stores-what-a-typed-array-reads",
    ["DataView.prototype.setFloat64"],
    [
      "const buffer = new ArrayBuffer(8);",
      "const floats = new Float64Array(buffer);",
      "console.log(floats[0]);",
      "new DataView(buffer).setFloat64(0, 2.5, true);",
      "console.log(floats[0] + 1);",
    ],
  ],
  [
    "a-data-view-stores-an-integer-that-a-typed-array-reads",
    ["DataView.prototype.setInt32"],
    [
      "const buffer = new ArrayBuffer(4);",
      "const view = new Int32Array(buffer);",
      "console.log(view[0]);",
      "new DataView(buffer).setInt32(0, -5, true);",
      "console.log(view[0] + 1);",
    ],
  ],
  [
    "a-buffer-write-stores-what-a-typed-array-reads",
    ["Buffer.prototype.writeDoubleLE"],
    [
      "const buffer = new ArrayBuffer(8);",
      "const floats = new Float64Array(buffer);",
      "console.log(floats[0]);",
      "Buffer.from(buffer).writeDoubleLE(2.5, 0);",
      "console.log(floats[0] + 1);",
    ],
  ],
  [
    "text-encoder-encode-into-stores-bytes",
    ["TextEncoder.prototype.encodeInto"],
    [
      "const view = new Uint8Array(4);",
      "console.log(view[0]);",
      'const answer = new TextEncoder().encodeInto("hi", view);',
      "console.log(view[0], view[1], view[2], answer.read + 1, answer.written + 1);",
    ],
  ],
  [
    "atomics-store-and-add-change-a-typed-array",
    ["Atomics.store", "Atomics.add"],
    [
      "const view = new Int32Array(2);",
      "console.log(view[0]);",
      "console.log(Atomics.store(view, 0, 5), Atomics.add(view, 0, 2));",
      "console.log(view[0] + 1);",
    ],
  ],
  [
    "array-buffer-transfer-detaches-the-buffer-of-a-view",
    ["ArrayBuffer.prototype.transfer"],
    [
      "const buffer = new ArrayBuffer(8);",
      "const view = new Uint8Array(buffer);",
      "view[0] = 7;",
      "const moved = buffer.transfer();",
      "console.log(view.length, view[0] === undefined, buffer.byteLength, buffer.detached, new Uint8Array(moved)[0]);",
    ],
  ],
  [
    "structured-clone-with-transfer-detaches-the-buffer-of-a-view",
    ["structuredClone"],
    [
      "const buffer = new ArrayBuffer(8);",
      "const view = new Uint8Array(buffer);",
      "view[0] = 7;",
      "const moved = structuredClone(buffer, { transfer: [buffer] });",
      "console.log(view.length, view[0] === undefined, buffer.byteLength, new Uint8Array(moved)[0]);",
    ],
  ],
  [
    "array-buffer-resize-changes-the-length-of-a-view",
    ["ArrayBuffer.prototype.resize"],
    [
      "const buffer = new ArrayBuffer(4, { maxByteLength: 8 });",
      "const view = new Uint8Array(buffer);",
      "console.log(view.length);",
      "buffer.resize(8);",
      "console.log(view.length, view[7]);",
      "buffer.resize(2);",
      "console.log(view.length, view[3] === undefined);",
    ],
  ],
  [
    "typed-array-subarray-shares-its-bytes",
    ["%TypedArray%.prototype.subarray"],
    [
      "const view = new Uint8Array([1, 2, 3]);",
      "const part = view.subarray(1);",
      "part[0] = 9;",
      "console.log(view[1] + 1, part.length);",
    ],
  ],
  [
    "typed-array-slice-copies-its-bytes",
    ["%TypedArray%.prototype.slice"],
    [
      "const view = new Uint8Array([1, 2, 3]);",
      "const part = view.slice(1);",
      "part[0] = 9;",
      "console.log(view[1] + 1, part[0] + 1);",
    ],
  ],
  [
    "buffer-slice-shares-its-bytes",
    ["Buffer.prototype.slice"],
    [
      "const buffer = Buffer.from([1, 2, 3]);",
      "const part = buffer.slice(1);",
      "part[0] = 9;",
      "console.log(buffer[1] + 1, part.length);",
    ],
  ],
  [
    "typed-array-copy-within-moves-bytes",
    ["%TypedArray%.prototype.copyWithin"],
    ["const view = new Uint8Array([1, 2, 3, 4]);", "view.copyWithin(0, 2);", "console.log(view.join());"],
  ],
  [
    "typed-array-sort-orders-floats-with-not-a-number",
    ["%TypedArray%.prototype.sort"],
    [
      "const view = new Float64Array([2.5, NaN, -0, 0, -1.5]);",
      "view.sort();",
      "console.log(view.join(), Object.is(view[1], -0));",
    ],
  ],
  [
    "buffer-fill-stores-text",
    ["Buffer.prototype.fill"],
    [
      "const buffer = Buffer.alloc(4);",
      "console.log(buffer[0]);",
      'buffer.fill("ab");',
      "console.log(buffer[0], buffer[1], buffer[2] + 1);",
    ],
  ],
  [
    "buffer-copy-stores-bytes-in-a-typed-array",
    ["Buffer.prototype.copy"],
    [
      "const view = new Uint8Array(3);",
      "console.log(view[0]);",
      "Buffer.from([7, 8]).copy(view, 1);",
      "console.log(view[0], view[1] + 1, view[2] + 1);",
    ],
  ],
  [
    "uint8-array-set-from-hex-stores-bytes",
    ["Uint8Array.prototype.setFromHex"],
    [
      "const view = new Uint8Array(2);",
      "console.log(view[0]);",
      'const answer = view.setFromHex("ff01");',
      "console.log(view[0] + 1, view[1] + 1, answer.read, answer.written);",
    ],
  ],
];

export function storePrograms(): Program[] {
  const programs: Program[] = [];
  for (const writer of writers) {
    for (const target of targets) {
      programs.push({
        name: `${writer.words}-${target.words}`,
        rows: writer.rows,
        text: lines(target.text, `console.log(${target.next});`, writer.text, (writer.after ?? usesText)(target)),
      });
    }
  }
  for (const target of targets) {
    programs.push({
      name: `a-plain-store-puts-text-into-${target.words}-honest`,
      rows: [],
      text: lines(target.text, `console.log(${target.next});`, 'target.value = "text";', usesText(target)),
    });
  }
  for (const writer of listWriters) {
    for (const [words, list] of writer.list === undefined
      ? [
          ["a-list-of-integers", "[1, 2, 3]"],
          ["a-list-of-fractions", "[1.5, 2.5, 3.5]"],
        ]
      : [["a-list", writer.list]]) {
      programs.push({
        name: `${writer.words}-${words}`,
        rows: writer.rows,
        text: lines(`const list = ${list};`, writer.text, writer.after),
      });
    }
  }
  programs.push({
    name: "a-plain-store-puts-text-in-a-list-of-integers-honest",
    rows: [],
    text: lines("const list = [1, 2, 3];", 'list[0] = "text";', kinds, "console.log(list[0].length);", sum),
  });
  for (const [name, rows, text] of bytes) programs.push({ name, rows, text: lines(text) });
  return programs;
}
