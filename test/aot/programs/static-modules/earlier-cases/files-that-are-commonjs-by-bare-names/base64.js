"use strict";
/**
 * As @protobufjs/base64 begins.
 */
var base64 = exports;
base64.sizeOf = function sizeOf(string) { return string.length * 3 / 4; };
base64.looksRight = function looksRight(string) { return /^[A-Za-z0-9+/]*$/.test(string); };
