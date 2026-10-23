// A store in code that folding removed adds no member.
class D {
  constructor() {
    if (false) {
      this.a = 1;
    }
    this.b = 1;
  }
}
