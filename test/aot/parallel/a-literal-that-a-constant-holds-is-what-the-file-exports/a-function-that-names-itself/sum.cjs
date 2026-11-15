"use strict";
const held = {
  down: function down(n) {
    return n > 0 ? n + down(n - 1) : 0;
  },
};
module.exports = held;
