'use strict'

/**
 * Module dependencies.
 */

const bytes = require('bytes')
const contentType = require('content-type')
const typeis = require('type-is')

/**
 * Module exports.
 */
module.exports = {
  getCharset,
  normalizeOptions,
  passthrough
}

/**
 * Get the charset of a request.
 *
 * @param {Object} req
 * @returns {string | undefined}
 * @private
 */
function getCharset (req: any) {
  const header = req.headers['content-type']
  if (!header) return undefined
  return contentType.parse(header).parameters.charset?.toLowerCase()
}

/**
 * Get the simple type checker.
 *
 * @param {string | string[]} type
 * @returns {Function}
 * @private
 */
function typeChecker (type: any) {
  return function checkType (req: any) {
    return Boolean(typeis(req, type))
  }
}

/**
 * Normalizes the common options for all parsers.
 *
 * @param {Object} options options to normalize
 * @param {string | string[] | Function} defaultType default content type(s) or a function to determine it
 * @returns {Object}
 * @private
 */
function normalizeOptions (options: any, defaultType: any) {
  if (!defaultType) {
    // Parsers must define a default content type
    throw new TypeError('defaultType must be provided')
  }

  const inflate = options?.inflate !== false
  const limit = typeof options?.limit === 'undefined' || options?.limit === null
    ? 102400 // 100kb default
    : bytes.parse(options.limit)
  const type = options?.type || defaultType
  const verify = options?.verify || false
  const defaultCharset = options?.defaultCharset || 'utf-8'

  if (limit === null) {
    throw new TypeError(`option limit "${String(options.limit)}" is invalid`)
  }

  if (verify !== false && typeof verify !== 'function') {
    throw new TypeError('option verify must be function')
  }

  // create the appropriate type checking function
  const shouldParse = typeof type !== 'function'
    ? typeChecker(type)
    : type

  return {
    inflate,
    limit,
    verify,
    defaultCharset,
    shouldParse
  }
}

/**
 * Passthrough function that returns input unchanged.
 * Used by parsers that don't need to transform the data.
 *
 * @param {*} value
 * @returns {*}
 * @private
 */
function passthrough (value: any) {
  return value
}

declare var require: (name: string) => any;
declare var module: { exports: any };
declare var exports: any;
