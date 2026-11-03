// A link changes, and a member goes, in the middle of a loop that asks instanceof and calls the inherited member.
// The change and every question stand in callbacks, and the object also goes to a function that nobody knows: prototype-linked-anew-before-anything-asked-for-its-link.js says why.
function told(ask) { try { return String(ask()); } catch (error) { return "threw " + error.name; } }
function E8() {} function M8() {}
Object.setPrototypeOf(M8.prototype, E8.prototype);
class L8 extends M8 {}
class B8 { tag() { return 1; } }
E8.prototype.tag = function () { return 0; };
const l8 = new L8();
let yes = 0, tags = 0;
for (let i = 0; i < 2000; i++) {
  if (i === 1000) told(() => { delete E8.prototype.tag; Object.setPrototypeOf(E8.prototype, B8.prototype); });
  if (l8 instanceof B8) yes++;
  tags += l8.tag();
}
console.log(yes, tags, told(() => nobodyKnows(l8)));
