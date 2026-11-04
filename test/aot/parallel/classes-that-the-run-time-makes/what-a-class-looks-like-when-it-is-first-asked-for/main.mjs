import * as all from "./classes.mjs";
import Default, { Plain, Below, Failure, viaInnerName } from "./classes.mjs";
console.log(Object.keys(all).join());
console.log(Plain.name, Plain.length, typeof Plain, Plain === all.Plain, Plain.prototype.constructor === Plain);
console.log(Object.getOwnPropertyNames(Plain).join(), Object.getOwnPropertyNames(Plain.prototype).join());
console.log(Object.getPrototypeOf(Below) === Plain, Object.getPrototypeOf(Below.prototype) === Plain.prototype, Below.name, Below.length);
console.log(new Below(4).twice(), Below.make(5).twice(), new Below(1) instanceof Plain, new Plain(1) instanceof Below);
console.log(Object.getPrototypeOf(Failure) === Error, new Failure("text").message, new Failure("x").kind, new Failure("x") instanceof Error, Object.prototype.toString.call(new Failure("x")));
console.log(Default.name, new Default().m(), viaInnerName() === Plain);
const descriptor = Object.getOwnPropertyDescriptor(Plain.prototype, "size");
console.log(typeof descriptor.get, descriptor.set, descriptor.enumerable, descriptor.configurable);
const method = Object.getOwnPropertyDescriptor(Plain.prototype, "twice");
console.log(method.writable, method.enumerable, method.configurable, method.value.name, method.value.length);
const ofClass = Object.getOwnPropertyDescriptor(Plain, "prototype");
console.log(ofClass.writable, ofClass.enumerable, ofClass.configurable);
try {
  Plain();
} catch (error) {
  console.log(error.constructor.name);
}
