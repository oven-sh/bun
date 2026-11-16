process.argv.splice(1, 1);
        import { expect } from "bun:test";
        class Anything {
          static [Symbol.hasInstance]() {
            return true;
          }
        }
        const report = async run => {
          try {
            await run();
            console.log("passed");
          } catch (e) {
            console.log(e.message.split("\n").filter(Boolean).slice(1).join(" | "));
          }
        };
        const thrower = thrown => () => {
          throw thrown;
        };
        for (const thrown of ["boom", Symbol("boom"), 10n ** 30n, {}, { message: "an object" }, new TypeError("an error")]) {
          await report(() => expect(thrower(thrown)).not.toThrow(Anything));
        }
        await report(() => expect(Promise.reject("boom")).rejects.not.toThrow(Anything));
        await report(() => expect(thrower("boom")).not.toThrow(RangeError));
      