import { describe2, executeTestsNow2 } from "bun:test";

console.log("HIT 1");
describe2("abc", () => {
  console.log("HIT 2");
});
console.log("HIT 3");
describe2("abc", () => {
  console.log("HIT 4");
  describe2("abc", () => {
    console.log("HIT 7");
  });
  console.log("HIT 5");
  describe2("abc", () => {
    console.log("HIT 8");
  });
  console.log("HIT 6");
});
console.log("HIT 9");
await Promise.resolve(undefined);

const { promise, resolve } = Promise.withResolvers();

console.log("HIT 10");
describe2("abc", async () => {
  console.log("HIT 11");
  describe2("abc", async () => {
    console.log("HIT 14");
  });
});
console.log("HIT 12");
describe2("def", async () => {
  console.log("HIT 15");
  describe2("def", async () => {
    console.log("HIT 16");
  });
  describe2("def", () => {
    console.log("HIT 17");
  });
  describe2("def", async () => {
    console.log("HIT 18");
    resolve();
  });
});
console.log("HIT 13");

await promise;
console.log("ready to run tests now");

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
