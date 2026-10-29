// A definition without a value makes `constructor` of the object under `prototype` of a function enumerable. Whatever goes over the properties of the object then meets the function:
// JSON.stringify() asks it for toJSON, and what that answers is written.
function F() {}
F.toJSON = function () {
  return "called";
};
Object.defineProperty(F.prototype, "constructor", { enumerable: true });
console.log(JSON.stringify(F.prototype));
console.log(JSON.stringify({ held: [F.prototype] }));

function G() {}
G.toJSON = function () {
  return { deep: this === G };
};
Object.defineProperty(G.prototype, "constructor", { enumerable: true });
console.log(JSON.stringify({ ...G.prototype }));
console.log(JSON.stringify(Object.assign({ first: 1 }, G.prototype)));

class C {
  static toJSON() {
    return "static called";
  }
}
Object.defineProperty(C.prototype, "constructor", { enumerable: true });
console.log(JSON.stringify([C.prototype]));
