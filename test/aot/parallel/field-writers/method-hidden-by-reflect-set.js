// Reflect.set hides a method of the class on one instance: it creates an ordinary property, whatever its three arguments look like.
class B { #p() { return 3; } callP() { return this.#p(); } }
const ways = [b => Reflect.set(b, "callP", () => 33)];
for (const hide of ways) { const changed = new B(); console.log(changed.callP()); console.log(hide(changed)); console.log(changed.callP()); }
