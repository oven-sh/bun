/**
 * The `readline/promise` module provides an API for reading lines of input from a Readable stream one line at a time.
 *
 * @see [source](https://github.com/nodejs/node/blob/v18.0.0/lib/readline/promises.js)
 * @since v17.0.0
 */
declare module "readline/promises" {
  import { Readable, Writable } from "node:stream";
  import {
    Interface as _Interface,
    ReadLineOptions,
    Completer,
    AsyncCompleter,
    Direction,
  } from "node:readline";
  import { Abortable } from "node:events";

  class Interface extends _Interface {
    /**
     * The rl.question() method displays the query by writing it to the output, waits for user input to be provided on input,
     * then invokes the callback function passing the provided input as the first argument.
     *
     * When called, rl.question() will resume the input stream if it has been paused.
     *
     * If the readlinePromises.Interface was created with output set to null or undefined the query is not written.
     *
     * If the question is called after rl.close(), it returns a rejected promise.
     *
     * Example usage:
     *
     * ```js
     * const answer = await rl.question('What is your favorite food? ');
     * console.log(`Oh, so your favorite food is ${answer}`);
     * ```
     *
     * Using an AbortSignal to cancel a question.
     *
     * ```js
     * const signal = AbortSignal.timeout(10_000);
     *
     * signal.addEventListener('abort', () => {
     *   console.log('The food question timed out');
     * }, { once: true });
     *
     * const answer = await rl.question('What is your favorite food? ', { signal });
     * console.log(`Oh, so your favorite food is ${answer}`);
     * ```
     *
     * @since v17.0.0
     * @param query A statement or query to write to output, prepended to the prompt.
     */
    question(query: string): Promise<string>;
    question(query: string, options: Abortable): Promise<string>;
  }

  class Readline {
    /**
     * @param stream A TTY stream.
     */
    constructor(stream: Writable, options?: { autoCommit?: boolean });
    /**
     * The `rl.clearLine()` method adds to the internal list of pending action an action that clears current line of the associated `stream` in a specified direction identified by `dir`.
     * Call `rl.commit()` to see the effect of this method, unless `autoCommit: true` was passed to the constructor.
     */
    clearLine(dir: Direction): this;
    /**
     * The `rl.clearScreenDown()` method adds to the internal list of pending action an action that clears the associated `stream` from the current position of the cursor down.
     * Call `rl.commit()` to see the effect of this method, unless `autoCommit: true` was passed to the constructor.
     */
    clearScreenDown(): this;
    /**
     * The `rl.commit()` method sends all the pending actions to the associated `stream` and clears the internal list of pending actions.
     */
    commit(): Promise<void>;
    /**
     * The `rl.cursorTo()` method adds to the internal list of pending action an action that moves cursor to the specified position in the associated `stream`.
     * Call `rl.commit()` to see the effect of this method, unless `autoCommit: true` was passed to the constructor.
     */
    cursorTo(x: number, y?: number): this;
    /**
     * The `rl.moveCursor()` method adds to the internal list of pending action an action that moves the cursor relative to its current position in the associated `stream`.
     * Call `rl.commit()` to see the effect of this method, unless autoCommit: true was passed to the constructor.
     */
    moveCursor(dx: number, dy: number): this;
    /**
     * The `rl.rollback()` method clears the internal list of pending actions without sending it to the associated `stream`.
     */
    rollback(): this;
  }

  /**
   * The `readlinePromises.createInterface()` method creates a new `readlinePromises.Interface` instance.
   *
   * ```js
   * const readlinePromises = require('node:readline/promises');
   * const rl = readlinePromises.createInterface({
   *   input: process.stdin,
   *   output: process.stdout
   * });
   * ```
   *
   * Once the `readlinePromises.Interface` instance is created, the most common case is to listen for the `'line'` event:
   *
   * ```js
   * rl.on('line', (line) => {
   *   console.log(`Received: ${line}`);
   * });
   * ```
   *
   * If `terminal` is `true` for this instance then the `output` stream will get the best compatibility if it defines an `output.columns` property,
   * and emits a `'resize'` event on the `output`, if or when the columns ever change (`process.stdout` does this automatically when it is a TTY).
   *
   * ## Use of the `completer` function
   *
   * The `completer` function takes the current line entered by the user as an argument, and returns an `Array` with 2 entries:
   *
   * - An Array with matching entries for the completion.
   * - The substring that was used for the matching.
   *
   * For instance: `[[substr1, substr2, ...], originalsubstring]`.
   *
   * ```js
   * function completer(line) {
   *   const completions = '.help .error .exit .quit .q'.split(' ');
   *   const hits = completions.filter((c) => c.startsWith(line));
   *   // Show all completions if none found
   *   return [hits.length ? hits : completions, line];
   * }
   * ```
   *
   * The `completer` function can also returns a `Promise`, or be asynchronous:
   *
   * ```js
   * async function completer(linePartial) {
   *   await someAsyncWork();
   *   return [['123'], linePartial];
   * }
   * ```
   */
  function createInterface(
    input: Readable,
    output?: Writable,
    completer?: Completer | AsyncCompleter,
    terminal?: boolean,
  ): Interface;
  function createInterface(options: ReadLineOptions): Interface;
}
declare module "node:readline/promises" {
  export * from "readline/promises";
}
