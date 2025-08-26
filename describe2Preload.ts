import { beforeAll, afterAll, beforeEach, afterEach } from "bun:test";

beforeAll(() => {
  console.log("preload beforeAll");
});

afterAll(() => {
  console.log("preload afterAll");
});

beforeEach(() => {
  console.log("preload beforeEach");
});

afterEach(() => {
  console.log("preload afterEach");
});
