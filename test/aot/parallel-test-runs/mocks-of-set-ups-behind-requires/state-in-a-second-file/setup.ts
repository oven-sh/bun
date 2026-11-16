import { beforeEach, jest } from "bun:test";
beforeEach(() => {
  jest.doMock("./goods.ts", () => ({ ...jest.requireActual<any>("./goods.ts"), name: () => "hook" }));
});
