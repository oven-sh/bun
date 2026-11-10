export class Animal {
  legs = 4;
  constructor(name) {
    this.name = name;
  }
  speak() {
    return this.name + " makes a sound";
  }
}
