// A method that a helper stores on an object born empty is called like one written in the literal.
const key = JSON.parse('["written","stored"]'), box = JSON.parse("{}");
const later = (fill, held) => () => (held || fill((held = { exports: {} }).exports), held.exports);
box.written = { add(a, b) { return a + b | 0; }, low: a => a & 15, rate: 3, high: a => a >> 4 };
box.stored = later(exports => {
  exports.add = function (a, b) { return a + b | 0; };
  exports.low = a => a & 15;
  exports.rate = 3;
  exports.high = a => a >> 4;
})();
export const loops = {
  "methods written in the literal": n => { const x = box[key[0]]; let s = 0; for (let i = 0, end = n | 0; i < end; i++) s = (s + x.low(i) + x.high(i) + x.add(i, 1)) | 0; return s; },
  "methods that a helper stores": n => { const x = box[key[1]]; let s = 0; for (let i = 0, end = n | 0; i < end; i++) s = (s + x.low(i) + x.high(i) + x.add(i, 1)) | 0; return s; },
};
