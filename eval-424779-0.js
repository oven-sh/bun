process.argv.splice(1, 1);
        const { expect } = require("bun:test");
        class Lazy extends Promise {
          static get [Symbol.species]() {
            return Promise;
          }
          static create(how) {
            let start;
            const lazy = new Lazy((resolve, reject) => {
              start = () => (how === "resolve" ? resolve : reject)("started");
            });
            lazy.start = start;
            return lazy;
          }
          then(onFulfilled, onRejected) {
            this.start();
            return super.then(onFulfilled, onRejected);
          }
        }
        await expect(Lazy.create("resolve")).resolves.toBe("started");
        await expect(Lazy.create("reject")).rejects.toBe("started");
        await expect(Bun.$`exit 0`.quiet()).resolves.toMatchObject({ exitCode: 0 });
        await expect(Bun.$`exit 7`.quiet()).rejects.toMatchObject({ exitCode: 7 });
        console.log("ok");
      