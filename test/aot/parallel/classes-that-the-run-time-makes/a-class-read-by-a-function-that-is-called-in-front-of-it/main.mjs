function early() {
  return new Late().m();
}
try {
  console.log(early());
} catch (error) {
  console.log(error.constructor.name);
}
class Late {
  m() {
    return "made";
  }
}
console.log(early());
