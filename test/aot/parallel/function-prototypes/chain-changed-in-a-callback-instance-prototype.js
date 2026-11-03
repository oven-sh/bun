// One instance gets another prototype, and a second instance of the class is asked too.
// The change and every question stand in callbacks, and the object also goes to a function that nobody knows: prototype-linked-anew-before-anything-asked-for-its-link.js says why.
function told(ask) { try { return String(ask()); } catch (error) { return "threw " + error.name; } }
class P { who() { return "P"; } }
class Q { who() { return "Q"; } }
const one = new P(), two = new P();
told(() => { Object.setPrototypeOf(one, Q.prototype); });
console.log(told(() => one.who()), told(() => two.who()), told(() => one instanceof P), told(() => one instanceof Q), told(() => two instanceof P), told(() => nobodyKnows(one, two)));
