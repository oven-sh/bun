// list.push(...source) where the list has no room: the elements are appended to the storage that was just made. The source may be the list itself.
"use strict";
const makes = [(n) => Array.from({ length: n }, (_, k) => k), (n) => Array.from({ length: n }, (_, k) => k + 0.5), (n) => Array.from({ length: n }, (_, k) => "s" + k), (n) => Array.from({ length: n }, (_, k) => (k % 3 ? k : { k })), (n) => new Array(n), (n) => Array.from({ length: n }, (_, k) => (k % 2 ? k : k / 4))];
class Bag {
  #list = [];
  constructor(...list) { this.#list.push(...list); }
  add(...list) { this.#list.push(...list); return this; }
  twice() { this.#list.push(...this.#list); return this; }
  get text() { return this.#list.length + ":" + this.#list.map((value) => (typeof value === "object" ? "o" + value.k : typeof value + value)).join(); }
}
function append(list, ...sources) { for (const source of sources) list.push(...source); return list; }
function show(list) { let sum = 0, text = ""; for (let k = 0; k < list.length; k++) { const value = list[k]; sum += typeof value === "number" ? value : 1; text += k in list ? (typeof value)[0] : "-"; } return list.length + ":" + sum + ":" + text.slice(0, 70); }
for (let n = 0; n < 70; n += n < 12 ? 1 : 7) {
  const lists = makes.map((make) => make(n));
  console.log(n, new Bag(...lists[0]).text, new Bag(...lists[1]).add(...lists[2]).text, new Bag(...lists[3].slice(0, 5)).twice().twice().text);
  for (const first of lists) for (const second of lists) {
    console.log(show(append([], first, second)), show(append(first.slice(), second, first)), show(append([1], second)), show(append([0.5], first, second)));
  }
  for (const first of lists) { const own = first.slice(); own.push(...own); own.push(...own); console.log(show(own), show(append(own, own))); }
}
