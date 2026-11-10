const unseen = (0, eval)("(x) => x");
const Base = (0, eval)("(class { constructor(a) { this.a = a; } })");
class Below extends Base {
  constructor(n) {
    const last = n | 0;
    for (let i = 0; i <= last; i++) {
      if (i === last) super(i);
    }
  }
}
console.log(new Below(unseen(3)).a);
