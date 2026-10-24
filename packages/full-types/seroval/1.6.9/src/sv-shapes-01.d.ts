// sv-shapes-01.d.ts: piece 01's additions (original.js 482..961)
declare namespace SV {
  type SettleStep = (step: IteratorStep) => void; // a Deferred's s where the promise is one that an async iterator's next() handed out (615 623 639): the literal { done, value } passed to it is checked against IteratorStep, so all nine births of { done, value } are ONE LAYOUT
}
