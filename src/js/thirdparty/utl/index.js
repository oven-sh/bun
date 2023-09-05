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
  //! non-standard properties, should these be kept? (not currently exposed)
  stylizeWithColor: util.stylizeWithColor,
  stylizeWithHTML: util.stylizeWithHTML,
};
