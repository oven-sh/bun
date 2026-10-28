// The function is only a parent: nothing constructs it. The first read through super comes before its prototype object gets the getter, the second after, the third after the class got another parent.
function Above() {}
Above.prototype = { constructor: Above };
class Below extends Above {
  take() {
    return super.held;
  }
}
console.log(new Below().take());
Object.defineProperty(Above.prototype, "held", {
  get() {
    return "late";
  },
  configurable: true,
});
console.log(new Below().take());
Object.setPrototypeOf(Below.prototype, {
  get held() {
    return "other";
  },
});
console.log(new Below().take());
