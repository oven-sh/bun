const unseen = (0, eval)("(x) => x");
let deeds = 0;
const Base = (0, eval)("(class { constructor(a) { this.a = a; } })");
class Below extends Base {
  constructor(n) {
    const last = n | 0;
    for (let i = 0; i <= last; i++) {
      deeds++;
      if (i === last) super(i);
    }
  }
}
console.log(new Below(unseen(3)).a, deeds);
