class Holder {
  held: any;
  constructor(held: any) {
    this.held = held;
  }
}
function use(holder: Holder): string {
  return String(holder.held("23"));
}
console.log(use(new Holder(JSON.parse("0").constructor)));
