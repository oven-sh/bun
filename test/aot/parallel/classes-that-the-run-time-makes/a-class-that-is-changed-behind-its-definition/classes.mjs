export class Plain {
  constructor(x) {
    this.x = x;
  }
  twice() {
    return this.x * 2;
  }
}
export class Below extends Plain {
  constructor(x) {
    super(x);
  }
  twice() {
    return "below " + super.twice();
  }
}
