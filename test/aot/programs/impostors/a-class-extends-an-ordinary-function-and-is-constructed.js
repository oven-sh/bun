function two() {
  return 2;
}

class Extended extends two {}

console.log(two(), typeof new Extended(), new Extended() instanceof two);
