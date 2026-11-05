interface Sized {
  size: number;
  run(): number;
}
function fail(): never {
  throw new Error("no size");
}
function listed(): Sized {
  return {
    size: fail(),
    run() {
      return 3;
    },
  };
}
function computed(): Sized {
  return {
    get size() {
      return 7;
    },
    run() {
      return 4;
    },
  };
}
let sum = 0;
for (let turn = 0; turn < 300; turn++) {
  try {
    sum += listed().size;
  } catch {
    sum += 1;
  }
  const made = computed();
  sum += made.size + made.run();
}
console.log(sum, Object.keys(computed()).join());
