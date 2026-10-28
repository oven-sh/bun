// The function is only a parent: nothing constructs it. The first call through super comes before its prototype object gets the method, the second after, the third after the class got another parent.
function Above() {}
Above.prototype = Object.create(null);
class Below extends Above {
  run() {
    try {
      return super.work();
    } catch (error) {
      return error.constructor.name;
    }
  }
}
console.log(new Below().run());
Above.prototype.work = function () {
  return "late";
};
console.log(new Below().run());
Object.setPrototypeOf(Below.prototype, {
  work() {
    return "other";
  },
});
console.log(new Below().run());
