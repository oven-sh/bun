export class Shown {
  m() {
    return "shown";
  }
}
export class Below extends Shown {
  m() {
    return "below " + super.m();
  }
}
