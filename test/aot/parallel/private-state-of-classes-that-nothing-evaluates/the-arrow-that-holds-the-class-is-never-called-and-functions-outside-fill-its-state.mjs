var __classPrivateFieldGet = (this && this.__classPrivateFieldGet) || function (receiver, state, kind, f) {
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
    return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
};
var __classPrivateFieldSet = (this && this.__classPrivateFieldSet) || function (receiver, state, value, kind, f) {
    if (kind === "m") throw new TypeError("Private method is not writable");
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a setter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot write private member to an object whose class did not declare it");
    return (kind === "a" ? f.call(receiver, value) : f ? f.value = value : state.set(receiver, value)), value;
};
var __classPrivateFieldIn = (this && this.__classPrivateFieldIn) || function(state, receiver) {
    if (receiver === null || (typeof receiver !== "object" && typeof receiver !== "function")) throw new TypeError("Cannot use 'in' operator on non-object");
    return typeof state === "function" ? receiver === state : state.has(receiver);
};
var _Gadget_instances = new WeakSet(), _Gadget_size = new WeakMap();
const makers = { gadget: () => class Gadget {
    constructor() { _Gadget_instances.add(this); _Gadget_size.set(this, 3); }
} };
function adopt(value) { _Gadget_instances.add(value); _Gadget_size.set(value, 7); }
function isGadget(value) { return __classPrivateFieldIn(_Gadget_instances, value); }
function sizeOf(value) { return __classPrivateFieldGet(value, _Gadget_size, "f"); }
function resize(value) { return __classPrivateFieldSet(value, _Gadget_size, 9, "f"); }
function said(work) { try { return work(); } catch (error) { return error.constructor.name + ": " + error.message; } }
const adopted = {}, other = {};
adopt(adopted);
console.log(Object.keys(makers).join(), isGadget(adopted), isGadget(other), sizeOf(adopted), resize(adopted), sizeOf(adopted));
console.log(said(() => sizeOf(other)), said(() => resize(other)), said(() => isGadget(1)));
console.log("DONE");
