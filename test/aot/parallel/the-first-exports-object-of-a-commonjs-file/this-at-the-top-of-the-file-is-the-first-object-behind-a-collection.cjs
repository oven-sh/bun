this.rows = new Array(500).fill(5);
module.exports = function replaced() {};
const self = this;
setTimeout(() => {
  Bun.gc(true);
  console.log(self === exports, self.rows.length, exports.rows[0], typeof module.exports);
}, 2);
