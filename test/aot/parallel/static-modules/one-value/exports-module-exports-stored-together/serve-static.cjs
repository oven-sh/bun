"use strict";
module.exports = serveStatic;
module.exports.mime = { html: "text/html" };
function serveStatic(root) {
  return () => root;
}
