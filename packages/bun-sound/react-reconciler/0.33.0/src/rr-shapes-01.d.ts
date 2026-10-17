// rr-shapes-01.d.ts: piece 1's additions (original.js 493..1007).
declare namespace RR {
  /**
   * What describeNativeComponentFrame (529) takes: a function component, a forwardRef's render, a class. given.
   * It is run with NOTHING (fn() 568, fn.call(proto) 560, Reflect.construct(fn, [], Fake) 553) to see where it throws: hence NO call signature:
   * FunctionComponent's would refuse fn(), ClassComponent has none. FunctionComponent and ClassComponent are both assignable to it.
   */
  interface ComponentFunction extends Function { displayName?: string }
  /**
   * The variable Fake of DetermineComponentFrameRoot (539): `any`, so NEVER IN A UNION. First a constructor that throws, run by Fake.call() with NOTHING (556: the
   * library's Function.call demands a thisArg: no type of a function lets that pass); then (568) what the user's component answers when called with nothing:
   * anything (a text, a number, an element, a promise), of which .catch is read whatever it is.
   */
  type FakeOrResult = any;
  /** Error.prepareStackTrace, as V8 and Bun know it. given (by anybody) */
  type PrepareStackTrace = (error: Error, structuredStackTrace: unknown[]) => unknown;
  /** births 574 576. In place of ComponentFrameSample: `control` is an Error's .stack, which the library has as string | undefined, and 595 tests it */
  type ComponentFrameStacks = [sample: string | null, control: string | null | undefined];
  /** birth 535. In place of RunInRootFrame, for the result above */
  interface RootFrameRunner { DetermineComponentFrameRoot: { (): ComponentFrameStacks; displayName?: string } }
}
