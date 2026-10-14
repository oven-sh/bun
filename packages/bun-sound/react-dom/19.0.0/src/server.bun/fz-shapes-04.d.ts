// fz-shapes-04.d.ts: carried over from 19.1.0's piece 4. IN THIS VERSION THE TWO NAMES ARE USED BY PIECE 3 (trackUsedThenable 2880 2896, is | objectIs 2931 2934); piece 4 (original.js 2990..3469: the hooks, the dispatchers, the component frames) adds no name of its own and uses fz-shapes-05.d.ts's two.
declare namespace FZ {
  // GIVEN
  type FulfilledValue = any; // what the user's thenable was fulfilled with: thenable.value, trackUsedThenable's result
  type ComparedValue = any; // what objectIs | is are handed: a member of the user's array of dependencies
}
