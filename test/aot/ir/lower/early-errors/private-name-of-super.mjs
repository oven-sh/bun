// RUN: lower
// DIAGNOSTIC: TS1034 1

var Kept = class extends Unknown { #x() {} method() { super.#x(); } };
