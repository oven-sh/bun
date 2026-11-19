// STATISTIC: CallsInlined >= 30
"use strict";
function clamp(value, low, high) {
  return value < low ? low : value > high ? high : value;
}
const Space = {};
(function () {
  function Features() {
    this._owner = null;
    this._red = 0;
    this._green = 1;
    this._blue = 2;
    this._alpha = 3;
    this._depth = 4;
    this._level = 5;
  }
  Space.Features = Features;
})();
(function () {
  const c = Space.Features;
  Object.defineProperty(c.prototype, "red", {
    enumerable: false,
    configurable: true,
    get: function () {
      return this._red;
    },
  });
  Object.defineProperty(c.prototype, "red", {
    enumerable: false,
    configurable: true,
    set: function (value) {
      if (value === undefined) value = 0;
      this._red = clamp(value, 0, 15);
      this._owner._key = (this._owner._key & 0xfffffff0) | ((this._red << 0) & 0xf);
    },
  });
  Object.defineProperty(c.prototype, "green", {
    enumerable: false,
    configurable: true,
    get: function () {
      return this._green;
    },
  });
  Object.defineProperty(c.prototype, "green", {
    enumerable: false,
    configurable: true,
    set: function (value) {
      if (value === undefined) value = 0;
      this._green = clamp(value, 0, 15);
      this._owner._key = (this._owner._key & 0xffffff0f) | ((this._green << 4) & 0xf0);
    },
  });
  Object.defineProperty(c.prototype, "blue", {
    enumerable: false,
    configurable: true,
    get: function () {
      return this._blue;
    },
  });
  Object.defineProperty(c.prototype, "blue", {
    enumerable: false,
    configurable: true,
    set: function (value) {
      if (value === undefined) value = 0;
      this._blue = clamp(value, 0, 15);
      this._owner._key = (this._owner._key & 0xfffff0ff) | ((this._blue << 8) & 0xf00);
    },
  });
  Object.defineProperty(c.prototype, "alpha", {
    enumerable: false,
    configurable: true,
    get: function () {
      return this._alpha;
    },
  });
  Object.defineProperty(c.prototype, "alpha", {
    enumerable: false,
    configurable: true,
    set: function (value) {
      if (value === undefined) value = 0;
      this._alpha = clamp(value, 0, 15);
      this._owner._key = (this._owner._key & 0xffff0fff) | ((this._alpha << 12) & 0xf000);
    },
  });
  Object.defineProperty(c.prototype, "depth", {
    enumerable: false,
    configurable: true,
    get: function () {
      return this._depth;
    },
  });
  Object.defineProperty(c.prototype, "depth", {
    enumerable: false,
    configurable: true,
    set: function (value) {
      if (value === undefined) value = 0;
      this._depth = clamp(value, 0, 15);
      this._owner._key = (this._owner._key & 0xfff0ffff) | ((this._depth << 16) & 0xf0000);
    },
  });
  Object.defineProperty(c.prototype, "level", {
    enumerable: false,
    configurable: true,
    get: function () {
      return this._level;
    },
  });
  Object.defineProperty(c.prototype, "level", {
    enumerable: false,
    configurable: true,
    set: function (value) {
      if (value === undefined) value = 0;
      this._level = clamp(value, 0, 15);
      this._owner._key = (this._owner._key & 0xff0fffff) | ((this._level << 20) & 0xf00000);
    },
  });
})();
const Features = Space.Features;
function Contact() {
  this._key = 0;
  this.features = new Features();
  this.features._owner = this;
}
function write(contact, value) {
  const features = contact.features;
  features.red = value;
  features.green = value;
  features.blue = value;
  features.alpha = value;
  features.depth = value;
  features.level = value;
  return features.red + features.level;
}
const contacts = [new Contact(), new Contact(), new Contact()];
let sum = 0;
for (let turn = 0; turn < 2000; turn++) sum += write(contacts[turn % 3], turn & 15);
console.log(sum, contacts.map((contact) => contact._key).join(), contacts[1].features.depth);
contacts[2].features.green = undefined;
console.log(contacts[2]._key, contacts[2].features.green, Object.keys(contacts[0].features).length);
