// `bun run` lists "constructor,b,a 3".
class Made {
  get a() {
    return 1;
  }
  b() {}
  set a(value) {}
  get a() {
    return 3;
  }
}
console.log(Object.getOwnPropertyNames(Made.prototype).join(), new Made().a);
/* Output:
constructor,a,b 3
*/
