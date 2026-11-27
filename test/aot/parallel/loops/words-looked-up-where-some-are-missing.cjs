// The same look-up where the record lacks a name, holds it above itself, answers by a getter, is a list, a text or a proxy, or is changed by the turn before.
"use strict";
function greeted(words, guests, also) {
  const out = [];
  for (let n = 0; n < guests.length; n++) {
    const guest = guests[n];
    if (guest.tongue === "mute") continue;
    const word = words[guest.tongue];
    out.push(word === undefined ? "-" : typeof word === "function" ? "f" : String(word));
    if (also) also(n, guest);
  }
  return out.join(" ");
}
module.exports = { greeted };
const guests = [];
for (let n = 0; n < 12; n++) guests.push({ tongue: ["fr", "it", "mute", "toString", "length", "0"][n % 6] });
const plain = JSON.parse('{"fr":"salut","it":"ciao"}');
for (let round = 0; round < 200; round++) greeted(plain, guests);
console.log(greeted(plain, guests));
console.log(greeted(Object.create({ fr: "above" }, { it: { get: () => "asked" } }), guests));
console.log(greeted(["zero", "one"], guests), "|", greeted("text", guests), "|", greeted(7, guests));
let asked = 0;
console.log(greeted(new Proxy(plain, { get: (o, k) => (asked++, o[k] + "!") }), guests), asked);
const changed = { fr: "salut", it: "ciao" };
console.log(greeted(changed, guests, n => (n === 1 ? delete changed.fr : n === 6 && (changed.it = "addio"))));
const turned = guests.map(guest => ({ tongue: guest.tongue }));
console.log(greeted(plain, turned, (n, guest) => n < 11 && (turned[n + 1].tongue = guest.tongue === "fr" ? Symbol.iterator : "fr")));
for (const words of [null, undefined])
  try {
    console.log(greeted(words, guests));
  } catch (error) {
    console.log(error.constructor.name);
  }
