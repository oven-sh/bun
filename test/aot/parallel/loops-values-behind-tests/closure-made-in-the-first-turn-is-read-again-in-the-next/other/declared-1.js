export const key = name => process.argv[9] ?? name;
export class Point {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
  norm() {
    return this.x + this.y;
  }
  get size() {
    return 2;
  }
  set kind(value) {
    this.x = value;
  }
  get both() {
    return this.y;
  }
  set both(value) {
    this.y = value;
  }
}
export class Below extends Point {
  z = 3;
}
export class Other {
  a = 1;
  norm() {
    return "other";
  }
}
export const read = it => it.late ?? it.parsed ?? "neither";
