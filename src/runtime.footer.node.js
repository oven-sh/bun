import * as __$module from "node:module";
export var $$m = BUN_RUNTIME.$$m;
export var __markAsModule = BUN_RUNTIME.__markAsModule;
export var $$lzy = BUN_RUNTIME.$$lzy;
export var __toModule = BUN_RUNTIME.__toModule;
export var __commonJS = BUN_RUNTIME.__commonJS;
export var __require = BUN_RUNTIME.__require;
export var __name = BUN_RUNTIME.__name;
export var __export = BUN_RUNTIME.__export;
export var __reExport = BUN_RUNTIME.__reExport;
export var __cJS2eSM = BUN_RUNTIME.__cJS2eSM;
export var regeneratorRuntime = BUN_RUNTIME.regeneratorRuntime;
export var __exportValue = BUN_RUNTIME.__exportValue;
export var __exportDefault = BUN_RUNTIME.__exportDefault;
export var __legacyDecorateClassTS = BUN_RUNTIME.__legacyDecorateClassTS;
export var __legacyDecorateParamTS = BUN_RUNTIME.__legacyDecorateParamTS;
export var __legacyMetadataTS = BUN_RUNTIME.__legacyMetadataTS;
export var $$bun_runtime_json_parse = JSON.parse;
export var __internalIsCommonJSNamespace = BUN_RUNTIME.__internalIsCommonJSNamespace;
var require = __$module.createRequire(import.meta.url);
var process =
  globalThis.process ||
  new Proxy(
    {},
    {
      get: function (target, prop, receiver) {
        var _process = require("process");
        target = process = _process;
        return Reflect.get(_process, prop, receiver);
      },
      apply: function (target, thisArg, argumentsList) {
        var _process = require("process");
        target = process = _process;
        return Reflect.apply(target, thisArg, argumentsList);
      },
      defineProperty(target, key, descriptor) {
        var _process = require("process");
        target = process = _process;
        return Reflect.defineProperty(_process, key, descriptor);
      },
      construct: function (target, args) {
        var _process = require("process");
        target = process = _process;
        return Reflect.construct(_process, args);
      },
      has: function (target, prop, receiver) {
        var _process = require("process");
        target = process = _process;
        return Reflect.has(_process, prop, receiver);
      },
    },
  );

var Buffer =
  globalThis.Buffer ||
  new Proxy(
    {},
    {
      get: function (target, prop, receiver) {
        var NewBuffer = require("buffer").Buffer;
        target = Buffer = NewBuffer;
        return Reflect.get(NewBuffer, prop, receiver);
      },
      apply: function (target, thisArg, argumentsList) {
        var NewBuffer = require("buffer").Buffer;
        target = Buffer = NewBuffer;
        return Reflect.apply(target, thisArg, argumentsList);
      },
      defineProperty(target, key, descriptor) {
        var NewBuffer = require("buffer").Buffer;
        target = Buffer = NewBuffer;
        return Reflect.defineProperty(NewBuffer, key, descriptor);
      },
      construct: function (target, args) {
        var NewBuffer = require("buffer").Buffer;
        target = Buffer = NewBuffer;
        return Reflect.construct(NewBuffer, args);
      },
      has: function (target, prop, receiver) {
        var NewBuffer = require("buffer").Buffer;
        target = Buffer = NewBuffer;
        return Reflect.has(NewBuffer, prop, receiver);
      },
    },
  );
