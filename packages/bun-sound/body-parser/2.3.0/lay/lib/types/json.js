/*!
 * body-parser
 * Copyright(c) 2014 Jonathan Ong
 * Copyright(c) 2014-2015 Douglas Christopher Wilson
 * MIT Licensed
 */

'use strict'

/**
 * Module dependencies.
 * @private
 */

const debug = require('debug')('body-parser:json')
const read = require('../read')
const { normalizeOptions } = require('../utils')

/**
 * Module exports.
 */

module.exports = json

/**
 * RegExp to match the first non-space in a string.
 *
 * Allowed whitespace is defined in RFC 7159:
 *
 *    ws = *(
 *            %x20 /              ; Space
 *            %x09 /              ; Horizontal tab
 *            %x0A /              ; Line feed or New line
 *            %x0D )              ; Carriage return
 */
const FIRST_CHAR_REGEXP = /^[\x20\x09\x0a\x0d]*([^\x20\x09\x0a\x0d])/ // eslint-disable-line no-control-regex

const JSON_SYNTAX_CHAR = '#'
const JSON_SYNTAX_REGEXP = /#+/g

/**
 * Create a middleware to parse JSON bodies.
 *
 * @param {Object} [options]
 * @returns {Function}
 * @public
 */
function json (options: any) {
  const normalizedOptions = normalizeOptions(options, 'application/json')

  const parse = createJsonParser(options)

  const readOptions = {
    ...normalizedOptions,
    // assert charset per RFC 7159 sec 8.1
    isValidCharset: (charset: any) => charset.slice(0, 4) === 'utf-'
  }

  return function jsonParser (req: any, res: any, next: any) {
    read(req, res, next, parse, debug, readOptions)
  }
}

/**
 * Create a JSON parse function
 *
 * @param {object} [options]
 * @return {function}
 * @private
 */
function createJsonParser (options: any) {
  const reviver = options?.reviver
  const strict = options?.strict !== false

  if (strict) {
    return function parse (body: any) {
      if (body.length === 0) {
        // special-case empty json body, as it's a common client-side mistake
        // TODO: maybe make this configurable or part of "strict" option
        return {}
      }

      const first = firstchar(body)
      if (first !== '{' && first !== '[') {
        debug('strict violation')
        throw createStrictSyntaxError(body, first)
      }

      try {
        debug('parse json')
        return JSON.parse(body, reviver)
      } catch (e: any) {
        throw normalizeJsonSyntaxError(e, {
          message: e.message,
          stack: e.stack
        })
      }
    }
  }

  return function parse (body: any) {
    if (body.length === 0) {
      // special-case empty json body, as it's a common client-side mistake
      // TODO: maybe make this configurable or part of "strict" option
      return {}
    }

    try {
      debug('parse json')
      return JSON.parse(body, reviver)
    } catch (e: any) {
      throw normalizeJsonSyntaxError(e, {
        message: e.message,
        stack: e.stack
      })
    }
  }
}

/**
 * Create strict violation syntax error matching native error.
 *
 * @param {string} str
 * @param {string} char
 * @returns {Error}
 * @private
 */
function createStrictSyntaxError (str: any, char: any) {
  const index = str.indexOf(char)
  let partial = ''

  if (index !== -1) {
    partial = str.substring(0, index) + JSON_SYNTAX_CHAR.repeat(str.length - index)
  }

  try {
    JSON.parse(partial); /* istanbul ignore next */ throw new SyntaxError('strict violation')
  } catch (e: any) {
    return normalizeJsonSyntaxError(e, {
      message: e.message.replace(JSON_SYNTAX_REGEXP, function (placeholder: any) {
        return str.substring(index, index + placeholder.length)
      }),
      stack: e.stack
    })
  }
}

/**
 * Get the first non-whitespace character in a string.
 *
 * @param {string} str
 * @returns {string|undefined}
 * @private
 */
function firstchar (str: any) {
  const match = FIRST_CHAR_REGEXP.exec(str)

  return match
    ? match[1]
    : undefined
}

/**
 * Normalize a SyntaxError for JSON.parse.
 *
 * @param {SyntaxError} error
 * @param {Object} obj
 * @returns {SyntaxError}
 * @private
 */
function normalizeJsonSyntaxError (error: any, obj: any) {
  const keys = Object.getOwnPropertyNames(error)

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]!
    if (key !== 'stack' && key !== 'message') {
      delete error[key]
    }
  }

  // replace stack before message for Node.js 0.10 and below
  error.stack = obj.stack.replace(error.message, obj.message)
  error.message = obj.message

  return error
}

declare var require: (name: string) => any;
declare var module: { exports: any };
declare var exports: any;
