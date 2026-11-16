process.argv.splice(1, 1);
        import { expect } from "bun:test";
        const caught = {};
        expect.extend({
          _printThrowingValue(received) {
            for (const util of ["stringify", "printExpected", "printReceived"]) {
              try {
                this.utils[util](received);
                caught[util] = "did not throw";
              } catch (e) {
                caught[util] = e.message;
              }
            }
            return { pass: true, message: () => "" };
          },
        });
        expect({
          [Symbol.for("nodejs.util.inspect.custom")]() {
            throw new Error("inspect failed");
          },
        })._printThrowingValue();
        console.log(JSON.stringify(caught));
      