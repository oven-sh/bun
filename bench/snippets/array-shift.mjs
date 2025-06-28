import { bench, run } from "../runner.mjs";

var myArray = new Array(5);
bench("[1, 2, 3, 4, 5].shift()", () => {
  // we do this to prevent constant folding optimizations
  if (myArray.length !== 5) myArray.length = 5;
  myArray[0] = 1;
  myArray[1] = 2;
  myArray[2] = 3;
  myArray[3] = 4;
  myArray[4] = 5;

  myArray.shift();
});

await run();
