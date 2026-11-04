const unseen = (0, eval)("(x) => x");
class First { constructor(a) { this.a = a; } }
class Second { constructor(a) { this.a = a * 2; } }
const Base = unseen(1) ? First : Second;
class Below extends Base {
  constructor(n) {
    const last = n | 0;
    for (let i = 0; i <= last; i++) {
      if (i === last) super(i);
    }
  }
}
console.log(new Below(unseen(3)).a);
