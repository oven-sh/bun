// sv-shapes-90.d.ts: GLOBALS THAT A HOST's `lib` MAY LACK: TanStack's own tsconfig says lib ES2024 + DOM: `Temporal` is unknown there: 26 errors: the package FELL (TS100009). A TYPED PACKAGE DECLARES EVERY GLOBAL IT NAMES THAT IS YOUNGER THAN ES2020 OR BELONGS TO A HOST (DOM, node): it may not lean on the host project's lib | types.
declare var Temporal: any;
declare var AggregateError: any;
