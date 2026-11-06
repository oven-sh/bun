// The prototype object of a class is reached by the getter of `__proto__`, taken out of its descriptor on Object.prototype and called on an instance, and a method is stored on what comes back:
// it replaces the method of the class for every instance. Nothing else in the program names a way to a prototype. What the method answers goes into String(), once, and nowhere else.
class K {
  m(): number | string {
    return 1;
  }
}
new K().m();
const getter = Object.getOwnPropertyDescriptor(Object.prototype, "__proto__")!.get!;
const handedOut: any = getter.call(new K());
const before = handedOut === K.prototype;
handedOut.m = () => "patched";
console.log(before, typeof handedOut, String(new K().m()), String((K.prototype as any).m()), Object.hasOwn(K.prototype, "m"));
