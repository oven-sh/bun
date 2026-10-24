// Stores follow the written members, in source order.
class S {
  constructor() {
    this.early = 1;
  }
  written = 0;
  m() { this.late = 2; }
}
S.label = "s";
