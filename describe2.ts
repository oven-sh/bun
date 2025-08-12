import { describe2, test2 } from "bun:test";

console.log("HIT 1");
describe2("abc", () => {
  console.log("HIT 2");

  test2("1", () => {});
});
console.log("HIT 3");
describe2("abc", () => {
  console.log("HIT 4");
  test2("2", () => {});
  describe2("abc", () => {
    console.log("HIT 7");
    test2("3", () => {});
  });
  console.log("HIT 5");
  test2("4", () => {});
  describe2("abc", () => {
    console.log("HIT 8");
    test2("5", () => {});
  });
  console.log("HIT 6");
  test2("6", () => {});
});
console.log("HIT 9");
test2("7", () => {});
await Promise.resolve(undefined);

const { promise, resolve } = Promise.withResolvers();

console.log("HIT 10");
test2("8", () => {});
describe2("abc", async () => {
  console.log("HIT 11");
  test2("9", () => {});
  describe2("abc", async () => {
    test2("10", () => {});
    console.log("HIT 14");
  });
  test2("11", () => {});
});
test2("12", () => {});
console.log("HIT 12");
describe2("def", async () => {
  test2("13", () => {});
  console.log("HIT 15");
  describe2("def", async () => {
    test2("14", () => {});
    console.log("HIT 16");
  });
  test2("15", () => {});
  describe2("def", () => {
    test2("16", () => {});
    console.log("HIT 17");
  });
  test2("17", () => {});
  describe2("def", async () => {
    test2("18", () => {});
    console.log("HIT 18");
    resolve();
    test2("19", () => {});
  });
  test2("20", () => {});
});
console.log("HIT 13");
test2("21", () => {});

await promise;
console.log("ready to run tests now");

await describe2.forDebuggingExecuteTestsNow();
describe2.forDebuggingDeinitNow();

/*
this one needs async context to handle properly:
describe2("abc", () => {
  setTimeout(() => {
    describe2("def", () => {
    
    });
  }, 0);
})

oh and here's the problem we're hitting:
describe2("", async () => {
  describe2("", async () => {
  });
});
the issue is that we call:
- describe
- inner describe
but we don't know 

we should look at vitest and see how it does describe ordering.

*/
