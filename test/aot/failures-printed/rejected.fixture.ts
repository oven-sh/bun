import { describe, expect, it, test } from "bun:test";

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));
async function load(name: string): Promise<string> {
  await sleep(1);
  if (name === "bad") throw new Error("cannot load " + name);
  return name;
}
async function loadAll(names: string[]): Promise<string[]> {
  const loaded: string[] = [];
  for (const name of names) loaded.push(await load(name));
  return loaded;
}

describe("rejections", () => {
  it("a returned promise", () => Promise.reject(new Error("returned and rejected")));
  it("behind an await", async () => {
    await sleep(1);
    throw new Error("thrown behind an await");
  });
  it("two async calls down", async () => {
    await loadAll(["good", "bad"]);
  });
  it("Promise.all", async () => {
    await Promise.all([load("good"), load("bad")]);
  });
  it("rejected with a string", () => Promise.reject("only a string"));
  it("in a then", () =>
    Promise.resolve(1).then(() => {
      throw new Error("thrown in then");
    }));
  it("in a timer", async () => {
    setTimeout(() => {
      throw new Error("thrown in a timer");
    }, 1);
    await sleep(10);
  });
  it("not awaited", async () => {
    void Promise.reject(new Error("nobody awaits this"));
    await sleep(5);
  });
});

describe("done", () => {
  it("done with an error", done => {
    done(new Error("handed to done"));
  });
  it("done later with an error", done => {
    setTimeout(() => done(new Error("handed to done later")), 1);
  });
  it("throws before done", done => {
    throw new Error("thrown before done");
    done();
  });
});

test("passes", async () => {
  expect(await load("good")).toBe("good");
});
