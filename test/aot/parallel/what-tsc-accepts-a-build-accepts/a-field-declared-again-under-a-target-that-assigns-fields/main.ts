export {};
class Parcel {
  label: string | number = "plain";
}
class Numbered extends Parcel {
  label!: number;
  constructor() {
    super();
    this.label = 7;
  }
}
console.log(new Numbered().label);
