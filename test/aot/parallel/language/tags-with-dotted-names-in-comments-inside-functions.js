// A `@callback` or `@typedef` tag with a dotted name stands for a namespace. In a comment it may stand wherever a comment may.
/** @typedef {Object} top.Level~Result */
/** @callback top.Level~update @param {string} text */
const seen = [];
(function () {
  var lunr = {};
  /**
   * @callback lunr.Token~updateFunction
   * @param {string} str
   * @param {Object} metadata
   */
  lunr.x = 1;
  /** @typedef {Object} lunr.Index~Result */
  lunr.y = 2;
  seen.push("a function called in place", lunr.x + lunr.y);
})();
function beforeReturn(value) {
  /** @typedef {{ a: number }} deep.er.and.deeper.Name */
  return value + 1;
}
function Made() {
  /** @callback Made.prototype~step @returns {number} */
  this.x = 3;
}
const arrow = value => {
  /** @typedef {number} arrow.Kind */
  const doubled = value * 2;
  return doubled;
};
class Holder {
  field = (() => {
    /** @typedef {string} Holder.Field */
    return "field";
  })();
  static {
    /** @callback Holder.Static~run */
    seen.push("a static block", 4);
  }
  method() {
    /** @typedef {Object} Holder.Method~Options @property {number} size */
    return this.field.length;
  }
  get read() {
    /** @callback Holder.Getter~read */
    return 5;
  }
}
function* steps() {
  /** @typedef {number} steps.Step */
  yield 6;
}
async function later() {
  /** @callback later.Done~call */
  return await 7;
}
{
  /** @typedef {Object} block.Kind */
  const inBlock = 8;
  seen.push("a block", inBlock);
}
if (seen.length) {
  /** @callback branch.Taken~call */
  seen.push("a branch", 9);
}
for (let i = 0; i < 1; i++) {
  /** @typedef {Object} loop.Body */
  seen.push("a loop", i);
}
switch (seen.length) {
  default:
    /** @typedef {Object} clause.Kind */
    seen.push("a clause", 10);
}
try {
  /** @callback attempt.Body~call */
  throw new Error("thrown");
} catch (error) {
  /** @typedef {Object} handler.Kind */
  seen.push("a handler", error.message);
} finally {
  /** @typedef {Object} last.Kind */
  seen.push("a finally", 11);
}
const object = {
  method() {
    /** @typedef {Object} object.Method */
    return 12;
  },
};
seen.push(beforeReturn(1), new Made().x, arrow(2), new Holder().method(), new Holder().read, steps().next().value, object.method());
later().then(value => console.log(seen.join(" | "), "|", value));
