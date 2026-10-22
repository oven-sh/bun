// fu-shapes-00.d.ts: piece 00's own addition.
declare namespace FU {
  // isArray (10) has two signatures. An argument of type `any` takes the first and STAYS any, in both arms; an argument with a written type takes the second and is narrowed.
  // Why: Array.isArray says true of a Proxy over an array (Vue's reactive(), MobX), and such arrays stand inside the user's items, in what a getFn gives and in a query's $and | $or.
  // Narrowed to any[] they are refused where they are used: "TypeError: expected any[], got native ProxyObject" (tried); npm walks them. 194 405 424 1350 1399 take the first; 160 164 1732 the second.
  // `value is Extract<T, any[]>` in one signature does not do: for T = any the other arm is `never` (140 144 153 202).
  type OnlyGiven<T> = 0 extends 1 & T ? T : never; // T where T is any; never for every other type, which no argument fits
}
