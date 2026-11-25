let first: string;
try { // @ts-expect-error
  first = new Gauge().state();
} catch (error) {
  first = (error as Error).name;
}
console.log(first);
var warm: boolean = true;
class Gauge {
  mode: string = warm ? "late" : "early";
  state(): string {
    return (warm ? "late" : "early") + " " + this.mode;
  }
}
console.log(new Gauge().state());
