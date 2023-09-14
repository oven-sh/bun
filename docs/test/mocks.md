Create mocks with the `mock` function.

```ts
import { test, expect, mock } from "bun:test";
const random = mock(() => Math.random());

test("random", async () => {
  const val = random();
  expect(val).toBeGreaterThan(0);
  expect(random).toHaveBeenCalled();
  expect(random).toHaveBeenCalledTimes(1);
});
```

The result of `mock()` is a new function that's been decorated with some additional properties.

```ts
import { mock } from "bun:test";
const random = mock((multiplier: number) => multiplier * Math.random());

random(2);
random(10);

random.mock.calls;
// [[ 2 ], [ 10 ]]

random.mock.results;
//  [
//    { type: "return", value: 0.6533907460954099 },
//    { type: "return", value: 0.6452713933037312 }
//  ]
```

## `.spyOn()`

It's possible to track calls to a function without replacing it with a mock. Use `spyOn()` to create a spy; these spies can be passed to `.toHaveBeenCalled()` and `.toHaveBeenCalledTimes()`.

```ts
import { test, expect, spyOn } from "bun:test";

const ringo = {
  name: "Ringo",
  sayHi() {
    console.log(`Hello I'm ${this.name}`);
  },
};

const spy = spyOn(ringo, "sayHi");

test("spyon", () => {
  expect(spy).toHaveBeenCalledTimes(0);
  ringo.sayHi();
  expect(spy).toHaveBeenCalledTimes(1);
});
```
