exports.makers = {
  open: function () { return { count: 1, list: [1] }; },
  frozen: function () { return Object.freeze({ count: 1, list: Object.freeze([1]) }); },
  sealed: function () { return Object.seal({ count: 1, list: Object.seal([1]) }); },
  closed: function () { return Object.preventExtensions({ count: 1, list: Object.preventExtensions([1]) }); },
  fixedCount: function () { return Object.defineProperty({ list: [1] }, "count", { value: 1, writable: false, enumerable: true, configurable: true }); },
  getterOnly: function () { return { get count() { return 1; }, get list() { return [1]; } }; },
  inheritedFixed: function () { return Object.create(Object.freeze({ count: 1, list: [1] })); },
  inheritedSetter: function () { var kept = []; return Object.create({ set count(value) { kept.push(value); }, get count() { return kept.length; }, list: kept }); },
  fixedLength: function () { return { count: 1, list: Object.defineProperty([1], "length", { writable: false }) }; },
};
