class C extends null {
  constructor() {
    super();
  }
}
try {
  new C();
  console.log("made");
} catch (error) {
  console.log(error.constructor.name);
}
