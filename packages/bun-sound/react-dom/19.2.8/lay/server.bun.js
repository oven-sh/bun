'use strict';

var b;
var l;
b = require('./cjs/react-dom-server.bun.production.ts');
l = require('./cjs/react-dom-server-legacy.browser.production.ts');

exports.version = b.version;
exports.renderToReadableStream = b.renderToReadableStream;
exports.resume = b.resume;
exports.renderToString = l.renderToString;
exports.renderToStaticMarkup = l.renderToStaticMarkup;
