/**
 *
 * This isn't really designed for third-party usage yet.
 * You can try it if you want though!
 *
 * To run the tests, run `bun wiptest`
 *
 * @example
 *
 * ```bash
 * $ bun wiptest
 * ```
 *
 * @example
 * ```bash
 * $ bun wiptest file-name
 * ```
 */

declare module "bun:test" {
  export function describe(label: string, body: () => void): any;
  export function it(label: string, test: () => void | Promise<any>): any;
  export function test(label: string, test: () => void | Promise<any>): any;

  export function expect(value: any): Expect;
  export function afterAll(fn: () => void): void;
  export function beforeAll(fn: () => void): void;

  export function afterEach(fn: () => void): void;
  export function beforeEach(fn: () => void): void;

  interface Expect {
    toBe(value: any): void;
    toContain(value: any): void;
  }
}

declare module "test" {
  import BunTestModule = require("bun:test");
  export = BunTestModule;
}
