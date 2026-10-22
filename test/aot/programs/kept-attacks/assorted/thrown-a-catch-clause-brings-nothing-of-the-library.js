// What an operation throws when it fails by itself is an error that the run time makes, and the compiler knows what such an error holds. So printing a member of what was caught needs no formatter for objects.
// STATISTIC: ImageFunctionsEmitted <= 40
class Body {
  constructor(mass) {
    this.mass = mass;
  }
}
const world = [new Body(1), new Body(2)];
const text = process.argv.length > 99 ? "1" : "{";
try {
  JSON.parse(text);
} catch (error) {
  console.log(error.name, typeof error.message);
}
try {
  throw world[1];
} catch (caught) {
  console.log(caught.mass);
}
try {
  world[5].mass;
} catch (error) {
  console.log(error.name, error.mass);
}
