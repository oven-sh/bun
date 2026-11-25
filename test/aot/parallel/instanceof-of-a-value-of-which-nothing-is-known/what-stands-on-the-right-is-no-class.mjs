import { round, makeThings, tell, Crate, Parcel } from "./the-questions.mjs";
const things = makeThings();
await round("other things on the right", { crate: things.crate, parcel: things.parcel, letter: things.letter, number: 7, nothing: null }, {
  bound: Crate.bind(null),
  boundClass: Parcel.bind(null),
  boundTwice: Crate.bind(null).bind(null),
  arrow: () => {},
  method: { method() {} }.method,
  literal: {},
  number: 5,
  absent: undefined,
  proxyOfClass: new Proxy(Parcel, {}),
  proxyOfFunction: new Proxy(Crate, { get: (target, key) => (key === "prototype" ? Parcel.prototype : Reflect.get(target, key)) }),
  answering: { [Symbol.hasInstance]: value => value === 7 },
});
tell();
