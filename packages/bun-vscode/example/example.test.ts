// @bun
const { afterEach, describe, expect, test } = Bun.jest(import.meta.path);

describe("example", () => {
  test("The", async () => {
    const s = await new Promise(resolve => {
      const s = Bun.serve({
        port: 3000,
        fetch: async () => {
          console.log("FETCHE!!");
          resolve(s);
          return Response.json("cool");
        },
      });
    });

    await Bun.sleep(100);

    s.stop(true);
  });

  if (Math) {
    console.log("Wow, what a surprise. this was called");
  } else {
    console.log("wtf?");
  }

  test("it works", () => {
    expect(1).toBe(1);
    expect(1).not.toBe(2);
    expect(() => {
      throw new TypeError("Oops! I did it again.");
    }).toThrow();
    expect(() => {
      throw new Error("Parent error.", {
        cause: new TypeError("Child error."),
      });
    }).toThrow();
    expect(() => {
      throw new AggregateError([new TypeError("Child error 1."), new TypeError("Child error 2.")], "Parent error.");
    }).toThrow();
    expect(() => {
      throw "This is a string error";
    }).toThrow();
    expect(() => {
      throw {
        message: "This is an object error",
        code: -1021,
      };
    }).toThrow();
  });
});

afterEach(async () => {
  await Bun.sleep(3000);
});
