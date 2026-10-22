class Box<T> {
  value: T;
  text: string;
  constructor(v: T) { this.value = this.wrap(v); this.text = this.show(); }
  wrap(v: T): T { return v; }
  show(): string { return "box " + String(this.value); }
}
class Doubled extends Box<number> {
  scale: number = 3;
  wrap(v: number): number { return v * 2; }
  show(): string { return "doubled " + this.value + " " + this.scale; }
}
class Named extends Box<string> {
  wrap(v: string): string { return v.toUpperCase(); }
}
console.log(new Doubled(2).text, new Doubled(2).scale, new Named("n").text, new Box(true).text);
