// RUN: lower
// DIAGNOSTIC: TS100050 shadow-realm-is-not-supported.js:8
// DIAGNOSTIC: TS100050 shadow-realm-is-not-supported.js:9

function ofLocal(ShadowRealm) {
  return new ShadowRealm();
}
export const made = new ShadowRealm();
export const method = ShadowRealm.prototype.evaluate;
export const asked = typeof ShadowRealm;
export const local = ofLocal(Object);
