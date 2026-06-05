// JavaScript injected into every main frame by the renderer process handler
// (helper_main.cpp, OnContextCreated). Builds the ipcRenderer API on top of
// the native __be_send/__be_invoke/__be_eval_done bindings, and provides the
// hooks (__be_dispatch/__be_reply/__be_eval) that native code calls back into.

#ifndef BUN_ELECTRON_RENDERER_BOOTSTRAP_H
#define BUN_ELECTRON_RENDERER_BOOTSTRAP_H

static const char kRendererBootstrapJs[] = R"BEJS(
(function () {
  'use strict';
  if (globalThis.__bunElectronBootstrapped) return;
  globalThis.__bunElectronBootstrapped = true;

  var listeners = Object.create(null); // channel -> [{fn, once}]
  var pendingInvokes = Object.create(null); // id -> {resolve, reject}
  var nextInvokeId = 1;

  // Structured-clone-ish serialization, mirroring src/serialize.ts.
  var TAG = '$bunElectron';

  function bytesToBase64(bytes) {
    var binary = '';
    for (var i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode.apply(
        null,
        bytes.subarray(i, i + 0x8000)
      );
    }
    return btoa(binary);
  }

  function base64ToBytes(b64) {
    var binary = atob(b64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function encodeValue(v) {
    if (v === undefined) { var u = {}; u[TAG] = 'undefined'; return u; }
    if (typeof v === 'number') {
      if (v !== v) return { '$bunElectron': 'number', v: 'nan' };
      if (v === Infinity) return { '$bunElectron': 'number', v: 'inf' };
      if (v === -Infinity) return { '$bunElectron': 'number', v: '-inf' };
      if (v === 0 && 1 / v === -Infinity) return { '$bunElectron': 'number', v: '-0' };
      return v;
    }
    if (typeof v === 'bigint') return { '$bunElectron': 'bigint', v: v.toString() };
    if (v === null || typeof v !== 'object') return v;
    if (v instanceof Date) return { '$bunElectron': 'date', v: v.getTime() };
    if (v instanceof RegExp) return { '$bunElectron': 'regexp', source: v.source, flags: v.flags };
    if (v instanceof Map) {
      var entries = [];
      v.forEach(function (val, key) { entries.push([encodeValue(key), encodeValue(val)]); });
      return { '$bunElectron': 'map', v: entries };
    }
    if (v instanceof Set) {
      var values = [];
      v.forEach(function (val) { values.push(encodeValue(val)); });
      return { '$bunElectron': 'set', v: values };
    }
    if (v instanceof ArrayBuffer) {
      return { '$bunElectron': 'arraybuffer', v: bytesToBase64(new Uint8Array(v)) };
    }
    if (ArrayBuffer.isView(v)) {
      return {
        '$bunElectron': 'typedarray',
        kind: v.constructor.name,
        v: bytesToBase64(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)),
      };
    }
    if (Array.isArray(v)) return v.map(encodeValue);
    var out = {};
    for (var k in v) {
      if (Object.prototype.hasOwnProperty.call(v, k)) out[k] = encodeValue(v[k]);
    }
    if (Object.prototype.hasOwnProperty.call(out, TAG)) {
      var wrapped = {};
      wrapped[TAG] = 'object';
      wrapped.v = out;
      return wrapped;
    }
    return out;
  }

  function decodeValue(v) {
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(decodeValue);
    var tag = v[TAG];
    if (typeof tag !== 'string') {
      var out = {};
      for (var k in v) {
        if (Object.prototype.hasOwnProperty.call(v, k)) out[k] = decodeValue(v[k]);
      }
      return out;
    }
    switch (tag) {
      case 'undefined': return undefined;
      case 'number':
        return v.v === 'nan' ? NaN : v.v === 'inf' ? Infinity : v.v === '-inf' ? -Infinity : -0;
      case 'bigint': return BigInt(v.v);
      case 'date': return new Date(v.v);
      case 'regexp': return new RegExp(v.source, v.flags);
      case 'map': {
        var m = new Map();
        v.v.forEach(function (entry) { m.set(decodeValue(entry[0]), decodeValue(entry[1])); });
        return m;
      }
      case 'set': {
        var s = new Set();
        v.v.forEach(function (val) { s.add(decodeValue(val)); });
        return s;
      }
      case 'arraybuffer': return base64ToBytes(v.v).buffer;
      case 'typedarray': {
        var bytes = base64ToBytes(v.v);
        var Ctor = globalThis[v.kind];
        if (!Ctor || v.kind === 'Uint8Array' || v.kind === 'Buffer') return bytes;
        return new Ctor(bytes.buffer);
      }
      case 'object': {
        var inner = {};
        for (var key in v.v) {
          if (Object.prototype.hasOwnProperty.call(v.v, key)) inner[key] = decodeValue(v.v[key]);
        }
        return inner;
      }
      default: return v;
    }
  }

  function getListeners(channel) {
    return listeners[channel] || (listeners[channel] = []);
  }

  var ipcRenderer = {
    send: function (channel) {
      var args = Array.prototype.slice.call(arguments, 1);
      __be_send(String(channel), JSON.stringify(args.map(encodeValue)));
    },
    invoke: function (channel) {
      var args = Array.prototype.slice.call(arguments, 1);
      var id = nextInvokeId++;
      return new Promise(function (resolve, reject) {
        pendingInvokes[id] = { resolve: resolve, reject: reject };
        __be_invoke(id, String(channel), JSON.stringify(args.map(encodeValue)));
      });
    },
    on: function (channel, fn) {
      getListeners(String(channel)).push({ fn: fn, once: false });
      return ipcRenderer;
    },
    once: function (channel, fn) {
      getListeners(String(channel)).push({ fn: fn, once: true });
      return ipcRenderer;
    },
    removeListener: function (channel, fn) {
      var arr = listeners[String(channel)];
      if (arr) {
        for (var i = arr.length - 1; i >= 0; i--) {
          if (arr[i].fn === fn) arr.splice(i, 1);
        }
      }
      return ipcRenderer;
    },
    removeAllListeners: function (channel) {
      if (channel === undefined) listeners = Object.create(null);
      else delete listeners[String(channel)];
      return ipcRenderer;
    },
    sendSync: function (channel) {
      var args = Array.prototype.slice.call(arguments, 1);
      var xhr = new XMLHttpRequest();
      xhr.open('POST', 'beipc://sync/', false); // synchronous by design
      try {
        xhr.send(JSON.stringify({
          channel: String(channel),
          args: args.map(encodeValue),
        }));
      } catch (e) {
        throw new Error('ipcRenderer.sendSync failed: ' + e);
      }
      if (xhr.status !== 200) {
        throw new Error('ipcRenderer.sendSync failed with status ' + xhr.status);
      }
      var parsed = JSON.parse(xhr.responseText || '{}');
      return decodeValue(parsed.value);
    },
  };

  // Native -> JS: ipcMain/webContents.send() delivery.
  globalThis.__be_dispatch = function (channel, argsJson) {
    var args;
    try {
      args = JSON.parse(argsJson).map(decodeValue);
    } catch (_) {
      args = [];
    }
    var arr = listeners[channel];
    if (!arr) return;
    var event = { sender: ipcRenderer, channel: channel };
    // Copy: a listener may mutate the list.
    arr.slice().forEach(function (entry) {
      if (entry.once) ipcRenderer.removeListener(channel, entry.fn);
      try {
        entry.fn.apply(null, [event].concat(args));
      } catch (err) {
        setTimeout(function () {
          throw err;
        }, 0);
      }
    });
  };

  // Native -> JS: resolution of ipcRenderer.invoke().
  globalThis.__be_reply = function (invokeId, resultJson, isError) {
    var pending = pendingInvokes[invokeId];
    if (!pending) return;
    delete pendingInvokes[invokeId];
    var value;
    try {
      value = isError ? JSON.parse(resultJson) : decodeValue(JSON.parse(resultJson));
    } catch (_) {
      value = resultJson;
    }
    if (isError) {
      var err = new Error(
        value && value.message ? value.message : String(value)
      );
      pending.reject(err);
    } else {
      pending.resolve(value);
    }
  };

  // Native -> JS: webContents.executeJavaScript() with result round-trip.
  globalThis.__be_eval = function (evalId, code) {
    var finish = function (value, isError) {
      var json;
      try {
        json = JSON.stringify(value);
        if (json === undefined) json = 'null';
      } catch (_) {
        json = JSON.stringify(String(value));
      }
      __be_eval_done(evalId, json, isError);
    };
    try {
      var result = (0, eval)(code);
      Promise.resolve(result).then(
        function (v) {
          finish(v, false);
        },
        function (e) {
          finish(e && e.message ? e.message : String(e), true);
        }
      );
    } catch (e) {
      finish(e && e.message ? e.message : String(e), true);
    }
  };

  // Without context isolation the "main world" is this context, so
  // exposeInMainWorld is a global assignment (Electron-compatible shape).
  var contextBridge = {
    exposeInMainWorld: function (name, api) {
      Object.defineProperty(globalThis, name, {
        value: api,
        writable: false,
        configurable: false,
        enumerable: true,
      });
    },
  };

  var electronModule = {
    ipcRenderer: ipcRenderer,
    contextBridge: contextBridge,
  };

  globalThis.bunElectron = electronModule;
  globalThis.ipcRenderer = ipcRenderer;
  globalThis.contextBridge = contextBridge;

  // Compatibility shim so `require('electron')` works in renderer code
  // written for Electron with nodeIntegration.
  if (typeof globalThis.require !== 'function') {
    globalThis.require = function (name) {
      if (name === 'electron') return electronModule;
      throw new Error("Cannot find module '" + name + "'");
    };
  }
})();
)BEJS";

#endif // BUN_ELECTRON_RENDERER_BOOTSTRAP_H
