class Arrow {
  target = () => new.target;
  now = new.target;
  list = [new.target];
  inherited = () => super.toString === Object.prototype.toString;
  x;
  constructor(x) {
    this.x = [x, new.target === Arrow];
  }
}
class Heir extends Arrow {
  own = new.target;
  y;
  constructor(y) {
    super(y);
    this.y = y;
  }
}
for (let i = 0; i < 3; i++) {
  const it = new Arrow(i), heir = new Heir(i);
  console.log(it.inherited(), it.target(), it.now, it.list.length, it.list[0], it.x.join(), heir.target(), heir.own, heir.x.join(), heir.y);
}
