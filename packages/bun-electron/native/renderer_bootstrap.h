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

  function getListeners(channel) {
    return listeners[channel] || (listeners[channel] = []);
  }

  var ipcRenderer = {
    send: function (channel) {
      var args = Array.prototype.slice.call(arguments, 1);
      __be_send(String(channel), JSON.stringify(args));
    },
    invoke: function (channel) {
      var args = Array.prototype.slice.call(arguments, 1);
      var id = nextInvokeId++;
      return new Promise(function (resolve, reject) {
        pendingInvokes[id] = { resolve: resolve, reject: reject };
        __be_invoke(id, String(channel), JSON.stringify(args));
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
  };

  // Native -> JS: ipcMain/webContents.send() delivery.
  globalThis.__be_dispatch = function (channel, argsJson) {
    var args;
    try {
      args = JSON.parse(argsJson);
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
      value = JSON.parse(resultJson);
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

  var electronModule = {
    ipcRenderer: ipcRenderer,
  };

  globalThis.bunElectron = electronModule;
  globalThis.ipcRenderer = ipcRenderer;

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

#endif  // BUN_ELECTRON_RENDERER_BOOTSTRAP_H
