class C {
  get p() {
    return 7;
  }
}
console.log(JSON.stringify([new C()], ["p"]));
