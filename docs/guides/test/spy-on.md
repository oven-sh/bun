---
name: Spy on methods in `bun test`
---

Use the `spyOn` utility to track method calls with Bun's test runner.

```ts
import { test, expect, spyOn } from "bun:test";

const leo = {
  name: "Leonardo",
  sayHi(thing: string) {
    console.log(`Sup I'm ${this.name} and I like ${thing}`);
  },
};

const spy = spyOn(leo, "sayHi");
```

---

Once the spy is created, it can be used to write `expect` assertions relating to method calls.

```ts-diff
  import { test, expect, spyOn } from "bun:test";

  const leo = {
    name: "Leonardo",
    sayHi(thing: string) {
      console.log(`Sup I'm ${this.name} and I like ${thing}`);
    },
  };

  const spy = spyOn(leo, "sayHi");

+ test("turtles", ()=>{
+   expect(spy).toHaveBeenCalledTimes(0);
+   leo.sayHi("pizza");
+   expect(spy).toHaveBeenCalledTimes(1);
+   expect(spy.mock.calls).toEqual([[ "pizza" ]]);
+ })
```

---

See [Docs > Test Runner > Mocks](/docs/test/mocks) for complete documentation on mocking with the Bun test runner.
