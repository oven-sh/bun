;(function () {
  var early = [seenEarly(0), viaHoistedCaller()];
  var PARTIAL_FLAG = 1, UNORDERED_FLAG = 2, BOTH = PARTIAL_FLAG | UNORDERED_FLAG, LIMIT = 200, INFINITY = 1 / 0, MINUS_ZERO = -0;
  var argsTag = "[object Arguments]", emptyText = "", numeric = "3";
  var EARLY = 7, LATER = 1, TWICE = 1, INCREMENTED = 1, IN_A_BRANCH, DESTRUCTURED = 1, LOOPED = 1, DELETED = 1;
  var TWICE = 2;
  if (early.length) var CONDITIONAL = 5;
  function hasFlag(mask) { return [mask & PARTIAL_FLAG, mask & UNORDERED_FLAG, mask & BOTH, mask > LIMIT, mask < INFINITY, Object.is(MINUS_ZERO, -0)]; }
  function isArgumentsTag(tag) { return [tag == argsTag, tag === argsTag, tag == emptyText, tag == numeric, tag + argsTag.length]; }
  function seenEarly(value) { return [EARLY, value]; }
  function viaHoistedCaller() { return viaHoistedCallee(); }
  function viaHoistedCallee() { return typeof argsTagSeenEarly + ":" + argsTagSeenEarly; }
  var argsTagSeenEarly = "text";
  function storedLater(value) { return [LATER, value]; }
  function storesLater() { LATER = 2; return LATER; }
  function others() { return [TWICE, INCREMENTED, IN_A_BRANCH, DESTRUCTURED, LOOPED, CONDITIONAL, typeof DELETED]; }
  function changes() { INCREMENTED++; [DESTRUCTURED] = [9]; for (LOOPED in { key: 1 }); IN_A_BRANCH = 4; return delete DELETED; }
  { function calledFromABlock() { return BLOCK; } var fromBlockEarly = calledFromABlock(), keptFromBlock = calledFromABlock; }
  var BLOCK = 6;
  var made = function () { return [PARTIAL_FLAG, argsTag, BLOCK]; };
  let LET_CONSTANT = 11, letStored = 12;
  function lets() { return [LET_CONSTANT, letStored]; }
  letStored = 13;
  module.exports = {
    early: early, fromBlockEarly: fromBlockEarly === undefined ? "undefined" : fromBlockEarly, hasFlag: hasFlag, isArgumentsTag: isArgumentsTag, seenEarly: seenEarly, storedLater: storedLater,
    before: [storedLater(0), others()], stores: [storesLater(), changes()], after: [storedLater(0), others()], made: made, lets: lets, viaHoistedCaller: viaHoistedCaller, keptFromBlock: keptFromBlock,
  };
}.call(this));
