"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
function makeItem(n) {
  const item = { id: n, weight: n + 1, secret: n * 2 };
  Object.defineProperty(item, "secret", { value: n * 2, writable: false });
  return item;
}
exports.makeItem = makeItem;
