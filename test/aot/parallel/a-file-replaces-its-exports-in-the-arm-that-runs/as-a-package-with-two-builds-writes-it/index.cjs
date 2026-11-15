'use strict';

if (process.env.NODE_ENV === 'production') {
  module.exports = require('./factory.cjs');
} else {
  module.exports = require('./factory.development.cjs');
}
