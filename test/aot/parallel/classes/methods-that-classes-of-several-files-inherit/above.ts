export class Top {
  count = 0;
  again() { this.count++; return this; }
  pair() { return [this, this] as const; }
  named(name: string) { return name + this.count; }
  take(other: this) { return other.count + this.count; }
  hidden() { return "top"; }
  make(): () => this { return () => this; }
}
export class Middle extends Top {
  middle = 1;
  twice() { return this.again().again(); }
  hidden() { return "middle" + super.hidden(); }
}
