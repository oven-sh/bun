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

{% callout %}
Alternatively, you can use the `jest.fn()` function, as in Jest. It behaves identically.

```ts
import { test, expect, jest } from "bun:test";
const random = jest.fn(() => Math.random());

test("random", async () => {
  const val = random();
  expect(val).toBeGreaterThan(0);
  expect(random).toHaveBeenCalled();
  expect(random).toHaveBeenCalledTimes(1);
});
```

{% /callout %}

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

The following properties and methods are implemented on mock functions.

- [x] [mockFn.getMockName()](https://jestjs.io/docs/mock-function-api#mockfngetmockname)
- [x] [mockFn.mock.calls](https://jestjs.io/docs/mock-function-api#mockfnmockcalls)
- [x] [mockFn.mock.results](https://jestjs.io/docs/mock-function-api#mockfnmockresults)
- [x] [mockFn.mock.instances](https://jestjs.io/docs/mock-function-api#mockfnmockinstances)
- [x] [mockFn.mock.contexts](https://jestjs.io/docs/mock-function-api#mockfnmockcontexts)
- [x] [mockFn.mock.lastCall](https://jestjs.io/docs/mock-function-api#mockfnmocklastcall)
- [x] [mockFn.mockClear()](https://jestjs.io/docs/mock-function-api#mockfnmockclear)
- [x] [mockFn.mockReset()](https://jestjs.io/docs/mock-function-api#mockfnmockreset)
- [x] [mockFn.mockRestore()](https://jestjs.io/docs/mock-function-api#mockfnmockrestore)
- [x] [mockFn.mockImplementation(fn)](https://jestjs.io/docs/mock-function-api#mockfnmockimplementationfn)
- [x] [mockFn.mockImplementationOnce(fn)](https://jestjs.io/docs/mock-function-api#mockfnmockimplementationoncefn)
- [x] [mockFn.mockName(name)](https://jestjs.io/docs/mock-function-api#mockfnmocknamename)
- [x] [mockFn.mockReturnThis()](https://jestjs.io/docs/mock-function-api#mockfnmockreturnthis)
- [x] [mockFn.mockReturnValue(value)](https://jestjs.io/docs/mock-function-api#mockfnmockreturnvaluevalue)
- [x] [mockFn.mockReturnValueOnce(value)](https://jestjs.io/docs/mock-function-api#mockfnmockreturnvalueoncevalue)
- [x] [mockFn.mockResolvedValue(value)](https://jestjs.io/docs/mock-function-api#mockfnmockresolvedvaluevalue)
- [x] [mockFn.mockResolvedValueOnce(value)](https://jestjs.io/docs/mock-function-api#mockfnmockresolvedvalueoncevalue)
- [x] [mockFn.mockRejectedValue(value)](https://jestjs.io/docs/mock-function-api#mockfnmockrejectedvaluevalue)
- [x] [mockFn.mockRejectedValueOnce(value)](https://jestjs.io/docs/mock-function-api#mockfnmockrejectedvalueoncevalue)
- [x] [mockFn.withImplementation(fn, callback)](https://jestjs.io/docs/mock-function-api#mockfnwithimplementationfn-callback)

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
