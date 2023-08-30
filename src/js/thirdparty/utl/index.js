// @ts-check
const util = /** @type {import('node-inspect-extracted')} */(/** @type {unknown}} */(require('./src/inspect.js')));

export default {
  // The commented out things are not visible from normal node's util.
  // identicalSequenceRange,
  inspect: util.inspect,
  // inspectDefaultOptions,
  format: util.format,
  formatWithOptions: util.formatWithOptions,
  // getStringWidth,
  stripVTControlCharacters: util.stripVTControlCharacters,
  // isZeroWidthCodePoint,
  stylizeWithColor: util.stylizeWithColor, //! non-standard property, should this be kept? (not currently exposed)
  stylizeWithHTML: util.stylizeWithHTML, //! non-standard property, should this be kept? (not currently exposed)
};
