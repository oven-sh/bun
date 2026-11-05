"use strict";
// A store site has created own fields. Then the prototype chain gains or uncovers a setter, a read-only property or a proxy. The next store must see it.
const log = [];
function setterHolder() {
  return { set url(v) { log.push("setter " + v); }, get url() { return "got"; } };
}
function readOnlyHolder() {
  return Object.defineProperty({}, "url", { value: "fixed", writable: false, configurable: true });
}
function trap() {
  return new Proxy({}, { set(target, key, value, receiver) { log.push("trap " + String(key) + " " + value); return true; } });
}

// Each kind makes a constructor, its prototype chain [prototype, middle, top] and a way to construct.
const kinds = {
  function() {
    function Message(url) { this.url = url; }
    return Message;
  },
  class() {
    return class Message { constructor(url) { this.url = url; } };
  },
  derived() {
    class Base {}
    return class Message extends Base { constructor(url) { super(); this.url = url; } };
  },
  field() {
    return class Message { other = 1; constructor(url) { this.url = url; } };
  },
  method() {
    return class Message { constructor(url) { this.set(url); } set(url) { this.url = url; } };
  },
  literal() {
    const prototype = {};
    function Message(url) { const o = { __proto__: prototype, first: 1 }; o.url = url; return o; }
    Message.prototype = prototype;
    return Message;
  },
  created() {
    const prototype = {};
    function Message(url) { const o = Object.create(prototype); o.url = url; return o; }
    Message.prototype = prototype;
    return Message;
  },
};

// What is on the chain before the first stores, and what happens after them.
const changes = {
  "delete uncovers a setter one above": {
    before(p) { p.url = ""; Object.setPrototypeOf(p, setterHolder()); },
    after(p) { delete p.url; },
  },
  "delete uncovers a read-only property one above": {
    before(p) { p.url = ""; Object.setPrototypeOf(p, readOnlyHolder()); },
    after(p) { delete p.url; },
  },
  "delete in the middle uncovers a setter at the top": {
    before(p) { const middle = { url: 1 }; Object.setPrototypeOf(middle, setterHolder()); Object.setPrototypeOf(p, middle); },
    after(p) { delete Object.getPrototypeOf(p).url; },
  },
  "Reflect.deleteProperty uncovers a setter": {
    before(p) { p.url = ""; Object.setPrototypeOf(p, setterHolder()); },
    after(p) { Reflect.deleteProperty(p, "url"); },
  },
  "delete by a computed key uncovers a setter": {
    before(p) { p.url = ""; Object.setPrototypeOf(p, setterHolder()); },
    after(p) { delete p[["u", "rl"].join("")]; },
  },
  "delete of a hiding method uncovers a setter": {
    before(p) { Object.defineProperty(p, "url", { value() {}, writable: true, configurable: true }); Object.setPrototypeOf(p, setterHolder()); },
    after(p) { delete p.url; },
  },
  "a setter is defined on the prototype": {
    before() {},
    after(p) { Object.defineProperty(p, "url", { set(v) { log.push("defined " + v); }, configurable: true }); },
  },
  "a setter is defined two above": {
    before(p) { Object.setPrototypeOf(p, Object.create({ top: 1 })); },
    after(p) { Object.defineProperty(Object.getPrototypeOf(Object.getPrototypeOf(p)), "url", { set(v) { log.push("top " + v); }, configurable: true }); },
  },
  "__defineSetter__ on the prototype": {
    before() {},
    after(p) { p.__defineSetter__("url", v => log.push("old style " + v)); },
  },
  "a plain property becomes a setter": {
    before(p) { p.url = ""; },
    after(p) { Object.defineProperty(p, "url", { set(v) { log.push("became " + v); } }); },
  },
  "a plain property becomes read-only": {
    before(p) { p.url = ""; },
    after(p) { Object.defineProperty(p, "url", { writable: false }); },
  },
  "the prototype is frozen": {
    before(p) { p.url = ""; },
    after(p) { Object.freeze(p); },
  },
  "a read-only property is defined on the prototype": {
    before() {},
    after(p) { Object.defineProperty(p, "url", { value: 1 }); },
  },
  "setPrototypeOf puts a setter above the prototype": {
    before() {},
    after(p) { Object.setPrototypeOf(p, setterHolder()); },
  },
  "__proto__ is assigned above the prototype": {
    before() {},
    after(p) { p.__proto__ = setterHolder(); },
  },
  "setPrototypeOf in the middle puts a setter at the top": {
    before(p) { Object.setPrototypeOf(p, { middle: 1 }); },
    after(p) { Object.setPrototypeOf(Object.getPrototypeOf(p), setterHolder()); },
  },
  "setPrototypeOf takes the hiding object out of the chain": {
    before(p) { const top = setterHolder(); const middle = Object.create(top); middle.url = 1; Object.setPrototypeOf(p, middle); },
    after(p) { Object.setPrototypeOf(p, Object.getPrototypeOf(Object.getPrototypeOf(p))); },
  },
  "a proxy is put above the prototype": {
    before() {},
    after(p) { Object.setPrototypeOf(p, trap()); },
  },
  "delete uncovers a proxy's trap": {
    before(p) { p.url = ""; Object.setPrototypeOf(p, trap()); },
    after(p) { delete p.url; },
  },
  "Object.assign brings nothing, defineProperties brings a setter": {
    before() {},
    after(p) { Object.assign(p, { other: 1 }); Object.defineProperties(p, { url: { set(v) { log.push("several " + v); }, configurable: true } }); },
  },
  "descriptors copied from an object with a setter": {
    before() {},
    after(p) { Object.defineProperties(p, Object.getOwnPropertyDescriptors(setterHolder())); },
  },
  "a setter comes and goes again": {
    before() {},
    after(p) { Object.defineProperty(p, "url", { set(v) { log.push("gone " + v); }, configurable: true }); delete p.url; },
  },
  "the setter that was uncovered is hidden again": {
    before(p) { p.url = ""; Object.setPrototypeOf(p, setterHolder()); },
    after(p) { delete p.url; p.other = 1; Object.defineProperty(p, "url", { value: 2, writable: true, configurable: true }); },
  },
  "a setter on Object.prototype's stand-in: a null-prototype top": {
    before(p) { Object.setPrototypeOf(p, Object.create(null)); },
    after(p) { Object.defineProperty(Object.getPrototypeOf(p), "url", { set(v) { log.push("bare " + v); }, configurable: true }); },
  },
};

for (const [kind, define] of Object.entries(kinds)) {
  for (const [change, { before, after }] of Object.entries(changes)) {
    for (const warm of [0, 1, 3, 40]) {
      const Message = define();
      const make = v => new Message(v);
      let line = kind + " | " + change + " | " + warm + " | ";
      try {
        before(Message.prototype);
        for (let i = 0; i < warm; i++) make("w" + i);
        log.length = 0;
        after(Message.prototype);
        const m = make("c");
        const n = make(7);
        line += log.join() + " | " + Object.keys(m).join() + " | " + Object.keys(n).join() + " | " + String(m.url) + " " + String(n.url);
      } catch (error) {
        line += error.constructor.name + " | " + log.join();
      }
      console.log(line);
      log.length = 0;
    }
  }
}
