function ten(value, context) {
  return initial => (initial ?? 0) + 10;
}
class Base {
  a = 1;
}
class Stored extends Base {
  @ten u;
  constructor(k) {
    super();
    this.u = k;
  }
}
class Printed extends Base {
  @ten u;
  constructor(k) {
    super();
    console.log(k);
  }
}
for (let i = 0; i < 3; i++) console.log(JSON.stringify(new Stored(i)), JSON.stringify(new Printed(i)));
