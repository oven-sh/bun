/*!
 * on-finished
 * Copyright(c) 2013 Jonathan Ong
 * Copyright(c) 2014 Douglas Christopher Wilson
 * MIT Licensed
 */

'use strict'

/**
 * Module exports.
 * @public
 */

module.exports = onFinished
module.exports.isFinished = isFinished

/**
 * Module dependencies.
 * @private
 */

var asyncHooks = tryRequireAsyncHooks()
var first: (stuff: [OF.Emitter, ...string[]][], done: (error: unknown) => void) => OF.Thunk = require('ee-first')

/**
 * Variables.
 * @private
 */

/* istanbul ignore next */
var defer = typeof setImmediate === 'function'
  ? setImmediate
  : function (fn: Function) { process.nextTick(fn.bind.apply(fn, arguments as unknown as [unknown])) }

/**
 * Invoke callback when the response has finished, useful for
 * cleaning up resources afterwards.
 *
 * @param {object} msg
 * @param {function} listener
 * @return {object}
 * @public
 */

function onFinished (msg: OF.Message, listener: OF.Listener) {
  if (isFinished(msg) !== false) {
    defer(listener, null, msg)
    return msg
  }

  // attach the listener to the message
  attachListener(msg, wrap(listener))

  return msg
}

/**
 * Determine if message is already finished.
 *
 * @param {object} msg
 * @return {boolean}
 * @public
 */

function isFinished (msg: OF.Message): boolean | undefined {
  var socket = msg.socket

  if (typeof msg.finished === 'boolean') {
    // OutgoingMessage
    return Boolean(msg.finished || (socket && !socket.writable))
  }

  if (typeof msg.complete === 'boolean') {
    // IncomingMessage
    return Boolean(msg.upgrade || !socket || !socket.readable || (msg.complete && !msg.readable))
  }

  // don't know
  return undefined
}

/**
 * Attach a finished listener to the message.
 *
 * @param {object} msg
 * @param {function} callback
 * @private
 */

function attachFinishedListener (msg: OF.Message, callback: (error: unknown) => void) {
  var eeMsg: OF.Thunk
  var eeSocket: OF.Thunk
  var finished = false

  function onFinish (error: unknown) {
    eeMsg.cancel()
    eeSocket.cancel()

    finished = true
    callback(error)
  }

  // finished on first message event
  eeMsg = eeSocket = first([[msg, 'end', 'finish']], onFinish)

  function onSocket (socket: OF.Emitter) {
    // remove listener
    msg.removeListener('socket', onSocket)

    if (finished) return
    if (eeMsg !== eeSocket) return

    // finished on first socket event
    eeSocket = first([[socket, 'error', 'close']], onFinish)
  }

  if (msg.socket) {
    // socket already assigned
    onSocket(msg.socket)
    return
  }

  // wait for socket to be assigned
  msg.on('socket', onSocket)

  if (msg.socket === undefined) {
    // istanbul ignore next: node.js 0.8 patch
    patchAssignSocket(msg, onSocket)
  }
}

/**
 * Attach the listener to the message.
 *
 * @param {object} msg
 * @return {function}
 * @private
 */

function attachListener (msg: OF.Message, listener: OF.Listener) {
  var attached = msg.__onFinished

  // create a private single listener with queue
  if (!attached || !attached.queue) {
    attached = msg.__onFinished = createListener(msg)
    attachFinishedListener(msg, attached)
  }

  attached.queue!.push(listener)
}

/**
 * Create listener on message.
 *
 * @param {object} msg
 * @return {function}
 * @private
 */

function createListener (msg: OF.Message): OF.Attached {
  function listener (err: unknown) {
    if (msg.__onFinished === listener) msg.__onFinished = null
    if (!listener.queue) return

    var queue = listener.queue
    listener.queue = null

    for (var i = 0; i < queue.length; i++) {
      queue[i]!(err, msg)
    }
  }

  listener.queue = [] as OF.Listener[] | null

  return listener
}

/**
 * Patch ServerResponse.prototype.assignSocket for node.js 0.8.
 *
 * @param {ServerResponse} res
 * @param {function} callback
 * @private
 */

// istanbul ignore next: node.js 0.8 patch
function patchAssignSocket (res: OF.Message, callback: (socket: OF.Emitter) => void) {
  var assignSocket = res.assignSocket

  if (typeof assignSocket !== 'function') return

  // res.on('socket', callback) is broken in 0.8
  res.assignSocket = function _assignSocket (this: OF.Message, socket: OF.Emitter) {
    assignSocket!.call(this, socket)
    callback(socket)
  }
}

/**
 * Try to require async_hooks
 * @private
 */

function tryRequireAsyncHooks () {
  try {
    return require('async_hooks')
  } catch (e) {
    return {}
  }
}

/**
 * Wrap function with async resource, if possible.
 * AsyncResource.bind static method backported.
 * @private
 */

function wrap (fn: OF.Listener): OF.Listener {
  var res

  // create anonymous resource
  if (asyncHooks.AsyncResource) {
    res = new asyncHooks.AsyncResource(fn.name || 'bound-anonymous-fn')
  }

  // incompatible node.js
  if (!res || !res.runInAsyncScope) {
    return fn
  }

  // return bound function
  return res.runInAsyncScope.bind(res, fn, null)
}

declare var require: (name: string) => any;
declare var module: { exports: any };
declare namespace OF {
  type Listener = (error: unknown, message: Message) => void;
  interface Attached { (error: unknown): void; queue: Listener[] | null }
  interface Thunk { (done: Function): void; cancel(): void }
  interface Emitter {
    on(event: string, listener: Function): unknown;
    removeListener(event: string, listener: Function): unknown;
    writable?: boolean; readable?: boolean;
  }
  interface Message extends Emitter {
    socket?: Emitter | null; finished?: boolean; complete?: boolean; upgrade?: boolean;
    __onFinished?: Attached | null; assignSocket?: (socket: Emitter) => void;
  }
}
