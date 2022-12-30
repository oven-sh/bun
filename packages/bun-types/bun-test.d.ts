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
  export function test(
    label: string,
    test: (done: (err?: any) => void) => void | Promise<any>,
  ): any;
  export { test as it };

  export function expect(value: any): Expect;
  export function afterAll(fn: () => void): void;
  export function beforeAll(fn: () => void): void;

  export function afterEach(fn: () => void): void;
  export function beforeEach(fn: () => void): void;

  interface Expect {
    not: Expect;
    toBe(value: any): void;
    toContain(value: any): void;
    toEqual(value: any): void;
    toStrictEqual(value: any): void;
    toHaveLength(value: number): void;
    toHaveProperty(key: string, value?: any): void;
    toBeTruthy(): void;
    toBeFalsy(): void;
    toBeDefined(): void;
    toBeUndefined(): void;
    toBeNaN(): void;
    toBeNull(): void;
    toBeGreaterThan(value: number | bigint): void;
    toBeGreaterThanOrEqual(value: number | bigint): void;
    toBeLessThan(value: number | bigint): void;
    toBeLessThanOrEqual(value: number | bigint): void;
    toMatchSnapshot(): void;
  }
}

declare module "test" {
  import BunTestModule = require("bun:test");
  export = BunTestModule;
}
