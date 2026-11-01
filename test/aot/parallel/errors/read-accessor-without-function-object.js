// Some accessors of built-in prototypes are native code without a function object: where a read of one throws, the stack trace has no frame of a getter. An accessor with a function object leaves one.
// Both hold where the compiler knows which accessor a read finds, where it does not, and where the function of a descriptor is called. It prints what plain Bun prints.
"use strict";
const opaque = value => [value, 0][Number(process.argv.length > 100)];
function framesOf(error) {
  const frames = [];
  for (const text of String(error.stack).split("\n")) {
    const frame = /^\s*at (?:(.*?) \()?([^()]*?)(?::(\d+):(\d+))?\)?$/.exec(text);
    if (!frame) continue;
    const file = frame[2].replace(/^.*[\\/]/, "");
    // Where a built-in that is written in JavaScript stands in its own text differs between builds of Bun.
    frames.push((frame[1] ?? "") + "@" + file + (frame[3] && file !== "native" ? ":" + frame[3] + ":" + frame[4] : ""));
  }
  return frames.slice(0, 3).join(" | ");
}
function attempt(label, run) {
  try {
    run();
    console.log(label, "-> no throw");
  } catch (error) {
    console.log(label, "->", error.name + ": " + error.message, framesOf(error));
  }
}

attempt("format of numbers", () => { Intl.NumberFormat.prototype.format; });
attempt("format of dates", () => { Intl.DateTimeFormat.prototype.format; });
attempt("compare", () => { Intl.Collator.prototype.compare; });
attempt("language", () => { Intl.Locale.prototype.language; });
attempt("size of a map", () => { Map.prototype.size; });
attempt("size of a set", () => { Set.prototype.size; });
attempt("byteLength", () => { ArrayBuffer.prototype.byteLength; });
attempt("description", () => { Symbol.prototype.description; });

attempt("href, below an object", () => { Object.create(URL.prototype).href; });
attempt("href, by its descriptor", () => { Object.getOwnPropertyDescriptor(URL.prototype, "href").get.call(opaque({})); });

// The read through `super` begins above the class, whatever the receiver has under the name.
class Address extends URL {
  get href() { return "address " + super.href; }
  get host() { return "host " + super.host; }
}
console.log(new Address("http://example.com:81/a").href, new Address("http://example.com:81/a").host);
attempt("href through super, no instance", () => { Object.create(Address.prototype).href; });
attempt("href through super, the prototype", () => { Address.prototype.href; });

const holders = opaque({ numbers: Intl.NumberFormat.prototype, dates: Intl.DateTimeFormat.prototype, texts: Intl.Collator.prototype, map: Map.prototype });
attempt("format of numbers, holder out of sight", () => { holders.numbers.format; });
attempt("format of dates, holder out of sight", () => { holders.dates.format; });
attempt("compare, holder out of sight", () => { holders.texts.compare; });
attempt("size of a map, holder out of sight", () => { holders.map.size; });
attempt("format of numbers, name out of sight", () => { Intl.NumberFormat.prototype[opaque("format")]; });

attempt("format of numbers, below an object", () => { Object.create(Intl.NumberFormat.prototype).format; });
attempt("compare, below an object", () => { Object.create(Intl.Collator.prototype).compare; });
attempt("format of numbers, by Reflect.get", () => { Reflect.get(Intl.NumberFormat.prototype, "format", opaque({})); });
attempt("format of numbers, by its descriptor", () => { Object.getOwnPropertyDescriptor(Intl.NumberFormat.prototype, "format").get.call(opaque({})); });
attempt("compare, by its descriptor", () => { Object.getOwnPropertyDescriptor(Intl.Collator.prototype, "compare").get.call(opaque({})); });

// The reads that answer.
const numbers = new Intl.NumberFormat("en-US"), dates = new Intl.DateTimeFormat("en-US", { timeZone: "UTC" }), texts = new Intl.Collator("en-US");
const format = numbers.format, formatDate = dates.format, compare = texts.compare;
console.log(format(1234.5), numbers.format(0.25), numbers.format === format, typeof format, format.name === "", format.length);
console.log(formatDate(0), dates.format(86400000), dates.format === formatDate, formatDate.length);
console.log(compare("a", "b"), texts.compare("b", "a"), ["b", "c", "a"].sort(texts.compare).join(), texts.compare === compare, compare.length);
console.log([1, 2.5, 1e6].map(numbers.format).join(" "), opaque(numbers).format(7), opaque(texts).compare("x", "x"));
