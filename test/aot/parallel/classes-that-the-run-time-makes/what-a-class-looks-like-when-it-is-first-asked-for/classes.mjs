export class Plain {
  constructor(x, y) {
    this.x = x;
  }
  twice() {
    return this.x * 2;
  }
  get size() {
    return 1;
  }
  static make(x) {
    return new Plain(x);
  }
  inner() {
    return Plain;
  }
}
export class Below extends Plain {
  twice() {
    return super.twice() + 1;
  }
}
export class Failure extends Error {
  get kind() {
    return "failure";
  }
}
export default class {
  m() {
    return "default";
  }
}
export function viaInnerName() {
  return new Plain(0).inner();
}
