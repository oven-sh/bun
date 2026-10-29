// @ts-nocheck
// What Intl's segments and HTMLRewriter's attributes answer under Symbol.iterator and next: a new iterator at each call of the first, the receiver itself for the second; each refuses a receiver of another sort.
const say = (...values) => console.log(...values);
const segments = new Intl.Segmenter("en", { granularity: "word" }).segment("one two");
const make = segments[Symbol.iterator];
const first = segments[Symbol.iterator](), second = segments[Symbol.iterator]();
say(first !== second, typeof first.next, Object.getPrototypeOf(Object.getPrototypeOf(first)) === Iterator.prototype, first[Symbol.iterator]() === first);
say([...segments].map(part => part.segment).join("|"), first.next().value.segment, second.next().value.segment, first.next().value.segment);
for (const wrong of [[1, 2], {}, undefined, null, 1, "text", new Map()])
  try { make.call(wrong); say("no error"); } catch (e) { say(e.name, e.message); }
const list = [1, 2, 3];
say(new Map(list.map(n => [n, n * 2])).get(2), [...list].length, list[Symbol.iterator]().next().value);
let kept;
const rewritten = new HTMLRewriter()
  .on("a", {
    element(element) {
      const attributes = element.attributes;
      kept = attributes;
      say(attributes[Symbol.iterator]() === attributes, typeof attributes.next);
      const seen = [];
      for (const [name, value] of attributes) seen.push(name + "=" + value);
      say(seen.join());
      const last = attributes.next();
      say(last.done, last.value, Object.keys(last).join());
      const prototype = Object.getPrototypeOf(attributes);
      for (const wrong of [[1], {}, undefined]) {
        try { prototype[Symbol.iterator].call(wrong); say("no error"); } catch (e) { say(e.name); }
        try { prototype.next.call(wrong); say("no error"); } catch (e) { say(e.name); }
      }
    },
  })
  .transform(new Response('<a href="x" id="y">t</a>'));
say(await rewritten.text());
say(kept.next().done);
