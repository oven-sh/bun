/**
 * @license React
 * react-server-dom-bun-client.node.development.js
 *
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

"use strict";
"production" !== process.env.NODE_ENV &&
  (function () {
    function resolveClientReference(bundlerConfig, metadata) {
      var modulePath = metadata[0],
        exportName = metadata[1];
      metadata = metadata[2];
      if (!bundlerConfig)
        return { specifier: modulePath, name: exportName, async: metadata };
      bundlerConfig = bundlerConfig[modulePath];
      if (!bundlerConfig)
        throw Error(
          'Could not find the module "' +
            modulePath +
            '" in the React Server Consumer Manifest. This is probably a bug in the React Server Components bundler.'
        );
      bundlerConfig =
        bundlerConfig[exportName] ||
        bundlerConfig["*"] ||
        bundlerConfig.default;
      if (!bundlerConfig || !bundlerConfig.specifier)
        throw Error(
          'Could not find the export "' +
            exportName +
            '" in module "' +
            modulePath +
            '" in the React Server Consumer Manifest.'
        );
      return {
        specifier: bundlerConfig.specifier,
        name: bundlerConfig.name,
        async: metadata
      };
    }
    function resolveServerReference(config, id) {
      var idx = id.lastIndexOf("#"),
        exportName = id.slice(idx + 1);
      id = id.slice(0, idx);
      if (!id.startsWith(config))
        throw Error(
          "Attempted to load a Server Reference outside the hosted root."
        );
      return { specifier: id, name: exportName };
    }
    function preloadModule(metadata) {
      var existingPromise = asyncModuleCache.get(metadata.specifier);
      if (existingPromise)
        return "fulfilled" === existingPromise.status ? null : existingPromise;
      var modulePromise = import(metadata.specifier);
      metadata.async
        ? modulePromise.then(
            function (value) {
              modulePromise.status = "fulfilled";
              modulePromise.value = value.default;
            },
            function (error) {
              modulePromise.status = "rejected";
              modulePromise.reason = error;
            }
          )
        : modulePromise.then(
            function (value) {
              modulePromise.status = "fulfilled";
              modulePromise.value = value;
            },
            function (error) {
              modulePromise.status = "rejected";
              modulePromise.reason = error;
            }
          );
      asyncModuleCache.set(metadata.specifier, modulePromise);
      return modulePromise;
    }
    function requireModule(metadata) {
      var moduleExports = asyncModuleCache.get(metadata.specifier);
      if (moduleExports)
        if ("fulfilled" === moduleExports.status)
          moduleExports = moduleExports.value;
        else throw moduleExports.reason;
      else
        throw Error(
          'Module "' + metadata.specifier + '" must be preloaded before use.'
        );
      return "*" === metadata.name
        ? moduleExports
        : "" === metadata.name
          ? moduleExports.default
          : moduleExports[metadata.name];
    }
    function getIteratorFn(maybeIterable) {
      if (null === maybeIterable || "object" !== typeof maybeIterable)
        return null;
      maybeIterable =
        (MAYBE_ITERATOR_SYMBOL && maybeIterable[MAYBE_ITERATOR_SYMBOL]) ||
        maybeIterable["@@iterator"];
      return "function" === typeof maybeIterable ? maybeIterable : null;
    }
    function isObjectPrototype(object) {
      if (!object) return !1;
      var ObjectPrototype = Object.prototype;
      if (object === ObjectPrototype) return !0;
      if (getPrototypeOf(object)) return !1;
      object = Object.getOwnPropertyNames(object);
      for (var i = 0; i < object.length; i++)
        if (!(object[i] in ObjectPrototype)) return !1;
      return !0;
    }
    function isSimpleObject(object) {
      if (!isObjectPrototype(getPrototypeOf(object))) return !1;
      for (
        var names = Object.getOwnPropertyNames(object), i = 0;
        i < names.length;
        i++
      ) {
        var descriptor = Object.getOwnPropertyDescriptor(object, names[i]);
        if (
          !descriptor ||
          (!descriptor.enumerable &&
            (("key" !== names[i] && "ref" !== names[i]) ||
              "function" !== typeof descriptor.get))
        )
          return !1;
      }
      return !0;
    }
    function objectName(object) {
      object = Object.prototype.toString.call(object);
      return object.slice(8, object.length - 1);
    }
    function describeKeyForErrorMessage(key) {
      var encodedKey = JSON.stringify(key);
      return '"' + key + '"' === encodedKey ? key : encodedKey;
    }
    function describeValueForErrorMessage(value) {
      switch (typeof value) {
        case "string":
          return JSON.stringify(
            10 >= value.length ? value : value.slice(0, 10) + "..."
          );
        case "object":
          if (isArrayImpl(value)) return "[...]";
          if (null !== value && value.$$typeof === CLIENT_REFERENCE_TAG)
            return "client";
          value = objectName(value);
          return "Object" === value ? "{...}" : value;
        case "function":
          return value.$$typeof === CLIENT_REFERENCE_TAG
            ? "client"
            : (value = value.displayName || value.name)
              ? "function " + value
              : "function";
        default:
          return String(value);
      }
    }
    function describeElementType(type) {
      if ("string" === typeof type) return type;
      switch (type) {
        case REACT_SUSPENSE_TYPE:
          return "Suspense";
        case REACT_SUSPENSE_LIST_TYPE:
          return "SuspenseList";
      }
      if ("object" === typeof type)
        switch (type.$$typeof) {
          case REACT_FORWARD_REF_TYPE:
            return describeElementType(type.render);
          case REACT_MEMO_TYPE:
            return describeElementType(type.type);
          case REACT_LAZY_TYPE:
            var payload = type._payload;
            type = type._init;
            try {
              return describeElementType(type(payload));
            } catch (x) {}
        }
      return "";
    }
    function describeObjectForErrorMessage(objectOrArray, expandedName) {
      var objKind = objectName(objectOrArray);
      if ("Object" !== objKind && "Array" !== objKind) return objKind;
      var start = -1,
        length = 0;
      if (isArrayImpl(objectOrArray))
        if (jsxChildrenParents.has(objectOrArray)) {
          var type = jsxChildrenParents.get(objectOrArray);
          objKind = "<" + describeElementType(type) + ">";
          for (var i = 0; i < objectOrArray.length; i++) {
            var value = objectOrArray[i];
            value =
              "string" === typeof value
                ? value
                : "object" === typeof value && null !== value
                  ? "{" + describeObjectForErrorMessage(value) + "}"
                  : "{" + describeValueForErrorMessage(value) + "}";
            "" + i === expandedName
              ? ((start = objKind.length),
                (length = value.length),
                (objKind += value))
              : (objKind =
                  15 > value.length && 40 > objKind.length + value.length
                    ? objKind + value
                    : objKind + "{...}");
          }
          objKind += "</" + describeElementType(type) + ">";
        } else {
          objKind = "[";
          for (type = 0; type < objectOrArray.length; type++)
            0 < type && (objKind += ", "),
              (i = objectOrArray[type]),
              (i =
                "object" === typeof i && null !== i
                  ? describeObjectForErrorMessage(i)
                  : describeValueForErrorMessage(i)),
              "" + type === expandedName
                ? ((start = objKind.length),
                  (length = i.length),
                  (objKind += i))
                : (objKind =
                    10 > i.length && 40 > objKind.length + i.length
                      ? objKind + i
                      : objKind + "...");
          objKind += "]";
        }
      else if (objectOrArray.$$typeof === REACT_ELEMENT_TYPE)
        objKind = "<" + describeElementType(objectOrArray.type) + "/>";
      else {
        if (objectOrArray.$$typeof === CLIENT_REFERENCE_TAG) return "client";
        if (jsxPropsParents.has(objectOrArray)) {
          objKind = jsxPropsParents.get(objectOrArray);
          objKind = "<" + (describeElementType(objKind) || "...");
          type = Object.keys(objectOrArray);
          for (i = 0; i < type.length; i++) {
            objKind += " ";
            value = type[i];
            objKind += describeKeyForErrorMessage(value) + "=";
            var _value2 = objectOrArray[value];
            var _substr2 =
              value === expandedName &&
              "object" === typeof _value2 &&
              null !== _value2
                ? describeObjectForErrorMessage(_value2)
                : describeValueForErrorMessage(_value2);
            "string" !== typeof _value2 && (_substr2 = "{" + _substr2 + "}");
            value === expandedName
              ? ((start = objKind.length),
                (length = _substr2.length),
                (objKind += _substr2))
              : (objKind =
                  10 > _substr2.length && 40 > objKind.length + _substr2.length
                    ? objKind + _substr2
                    : objKind + "...");
          }
          objKind += ">";
        } else {
          objKind = "{";
          type = Object.keys(objectOrArray);
          for (i = 0; i < type.length; i++)
            0 < i && (objKind += ", "),
              (value = type[i]),
              (objKind += describeKeyForErrorMessage(value) + ": "),
              (_value2 = objectOrArray[value]),
              (_value2 =
                "object" === typeof _value2 && null !== _value2
                  ? describeObjectForErrorMessage(_value2)
                  : describeValueForErrorMessage(_value2)),
              value === expandedName
                ? ((start = objKind.length),
                  (length = _value2.length),
                  (objKind += _value2))
                : (objKind =
                    10 > _value2.length && 40 > objKind.length + _value2.length
                      ? objKind + _value2
                      : objKind + "...");
          objKind += "}";
        }
      }
      return void 0 === expandedName
        ? objKind
        : -1 < start && 0 < length
          ? ((objectOrArray = " ".repeat(start) + "^".repeat(length)),
            "\n  " + objKind + "\n  " + objectOrArray)
          : "\n  " + objKind;
    }
    function serializeNumber(number) {
      return Number.isFinite(number)
        ? 0 === number && -Infinity === 1 / number
          ? "$-0"
          : number
        : Infinity === number
          ? "$Infinity"
          : -Infinity === number
            ? "$-Infinity"
            : "$NaN";
    }
    function processReply(
      root,
      formFieldPrefix,
      temporaryReferences,
      resolve,
      reject
    ) {
      function serializeTypedArray(tag, typedArray) {
        typedArray = new Blob([
          new Uint8Array(
            typedArray.buffer,
            typedArray.byteOffset,
            typedArray.byteLength
          )
        ]);
        var blobId = nextPartId++;
        null === formData && (formData = new FormData());
        formData.append(formFieldPrefix + blobId, typedArray);
        return "$" + tag + blobId.toString(16);
      }
      function serializeBinaryReader(reader) {
        function progress(entry) {
          entry.done
            ? ((entry = nextPartId++),
              data.append(formFieldPrefix + entry, new Blob(buffer)),
              data.append(
                formFieldPrefix + streamId,
                '"$o' + entry.toString(16) + '"'
              ),
              data.append(formFieldPrefix + streamId, "C"),
              pendingParts--,
              0 === pendingParts && resolve(data))
            : (buffer.push(entry.value),
              reader.read(new Uint8Array(1024)).then(progress, reject));
        }
        null === formData && (formData = new FormData());
        var data = formData;
        pendingParts++;
        var streamId = nextPartId++,
          buffer = [];
        reader.read(new Uint8Array(1024)).then(progress, reject);
        return "$r" + streamId.toString(16);
      }
      function serializeReader(reader) {
        function progress(entry) {
          if (entry.done)
            data.append(formFieldPrefix + streamId, "C"),
              pendingParts--,
              0 === pendingParts && resolve(data);
          else
            try {
              var partJSON = JSON.stringify(entry.value, resolveToJSON);
              data.append(formFieldPrefix + streamId, partJSON);
              reader.read().then(progress, reject);
            } catch (x) {
              reject(x);
            }
        }
        null === formData && (formData = new FormData());
        var data = formData;
        pendingParts++;
        var streamId = nextPartId++;
        reader.read().then(progress, reject);
        return "$R" + streamId.toString(16);
      }
      function serializeReadableStream(stream) {
        try {
          var binaryReader = stream.getReader({ mode: "byob" });
        } catch (x) {
          return serializeReader(stream.getReader());
        }
        return serializeBinaryReader(binaryReader);
      }
      function serializeAsyncIterable(iterable, iterator) {
        function progress(entry) {
          if (entry.done) {
            if (void 0 === entry.value)
              data.append(formFieldPrefix + streamId, "C");
            else
              try {
                var partJSON = JSON.stringify(entry.value, resolveToJSON);
                data.append(formFieldPrefix + streamId, "C" + partJSON);
              } catch (x) {
                reject(x);
                return;
              }
            pendingParts--;
            0 === pendingParts && resolve(data);
          } else
            try {
              var _partJSON = JSON.stringify(entry.value, resolveToJSON);
              data.append(formFieldPrefix + streamId, _partJSON);
              iterator.next().then(progress, reject);
            } catch (x$0) {
              reject(x$0);
            }
        }
        null === formData && (formData = new FormData());
        var data = formData;
        pendingParts++;
        var streamId = nextPartId++;
        iterable = iterable === iterator;
        iterator.next().then(progress, reject);
        return "$" + (iterable ? "x" : "X") + streamId.toString(16);
      }
      function resolveToJSON(key, value) {
        var originalValue = this[key];
        "object" !== typeof originalValue ||
          originalValue === value ||
          originalValue instanceof Date ||
          ("Object" !== objectName(originalValue)
            ? console.error(
                "Only plain objects can be passed to Server Functions from the Client. %s objects are not supported.%s",
                objectName(originalValue),
                describeObjectForErrorMessage(this, key)
              )
            : console.error(
                "Only plain objects can be passed to Server Functions from the Client. Objects with toJSON methods are not supported. Convert it manually to a simple value before passing it to props.%s",
                describeObjectForErrorMessage(this, key)
              ));
        if (null === value) return null;
        if ("object" === typeof value) {
          switch (value.$$typeof) {
            case REACT_ELEMENT_TYPE:
              if (void 0 !== temporaryReferences && -1 === key.indexOf(":")) {
                var parentReference = writtenObjects.get(this);
                if (void 0 !== parentReference)
                  return (
                    temporaryReferences.set(parentReference + ":" + key, value),
                    "$T"
                  );
              }
              throw Error(
                "React Element cannot be passed to Server Functions from the Client without a temporary reference set. Pass a TemporaryReferenceSet to the options." +
                  describeObjectForErrorMessage(this, key)
              );
            case REACT_LAZY_TYPE:
              originalValue = value._payload;
              var init = value._init;
              null === formData && (formData = new FormData());
              pendingParts++;
              try {
                parentReference = init(originalValue);
                var lazyId = nextPartId++,
                  partJSON = serializeModel(parentReference, lazyId);
                formData.append(formFieldPrefix + lazyId, partJSON);
                return "$" + lazyId.toString(16);
              } catch (x) {
                if (
                  "object" === typeof x &&
                  null !== x &&
                  "function" === typeof x.then
                ) {
                  pendingParts++;
                  var _lazyId = nextPartId++;
                  parentReference = function () {
                    try {
                      var _partJSON2 = serializeModel(value, _lazyId),
                        _data = formData;
                      _data.append(formFieldPrefix + _lazyId, _partJSON2);
                      pendingParts--;
                      0 === pendingParts && resolve(_data);
                    } catch (reason) {
                      reject(reason);
                    }
                  };
                  x.then(parentReference, parentReference);
                  return "$" + _lazyId.toString(16);
                }
                reject(x);
                return null;
              } finally {
                pendingParts--;
              }
          }
          if ("function" === typeof value.then) {
            null === formData && (formData = new FormData());
            pendingParts++;
            var promiseId = nextPartId++;
            value.then(function (partValue) {
              try {
                var _partJSON3 = serializeModel(partValue, promiseId);
                partValue = formData;
                partValue.append(formFieldPrefix + promiseId, _partJSON3);
                pendingParts--;
                0 === pendingParts && resolve(partValue);
              } catch (reason) {
                reject(reason);
              }
            }, reject);
            return "$@" + promiseId.toString(16);
          }
          parentReference = writtenObjects.get(value);
          if (void 0 !== parentReference)
            if (modelRoot === value) modelRoot = null;
            else return parentReference;
          else
            -1 === key.indexOf(":") &&
              ((parentReference = writtenObjects.get(this)),
              void 0 !== parentReference &&
                ((parentReference = parentReference + ":" + key),
                writtenObjects.set(value, parentReference),
                void 0 !== temporaryReferences &&
                  temporaryReferences.set(parentReference, value)));
          if (isArrayImpl(value)) return value;
          if (value instanceof FormData) {
            null === formData && (formData = new FormData());
            var _data3 = formData;
            key = nextPartId++;
            var prefix = formFieldPrefix + key + "_";
            value.forEach(function (originalValue, originalKey) {
              _data3.append(prefix + originalKey, originalValue);
            });
            return "$K" + key.toString(16);
          }
          if (value instanceof Map)
            return (
              (key = nextPartId++),
              (parentReference = serializeModel(Array.from(value), key)),
              null === formData && (formData = new FormData()),
              formData.append(formFieldPrefix + key, parentReference),
              "$Q" + key.toString(16)
            );
          if (value instanceof Set)
            return (
              (key = nextPartId++),
              (parentReference = serializeModel(Array.from(value), key)),
              null === formData && (formData = new FormData()),
              formData.append(formFieldPrefix + key, parentReference),
              "$W" + key.toString(16)
            );
          if (value instanceof ArrayBuffer)
            return (
              (key = new Blob([value])),
              (parentReference = nextPartId++),
              null === formData && (formData = new FormData()),
              formData.append(formFieldPrefix + parentReference, key),
              "$A" + parentReference.toString(16)
            );
          if (value instanceof Int8Array)
            return serializeTypedArray("O", value);
          if (value instanceof Uint8Array)
            return serializeTypedArray("o", value);
          if (value instanceof Uint8ClampedArray)
            return serializeTypedArray("U", value);
          if (value instanceof Int16Array)
            return serializeTypedArray("S", value);
          if (value instanceof Uint16Array)
            return serializeTypedArray("s", value);
          if (value instanceof Int32Array)
            return serializeTypedArray("L", value);
          if (value instanceof Uint32Array)
            return serializeTypedArray("l", value);
          if (value instanceof Float32Array)
            return serializeTypedArray("G", value);
          if (value instanceof Float64Array)
            return serializeTypedArray("g", value);
          if (value instanceof BigInt64Array)
            return serializeTypedArray("M", value);
          if (value instanceof BigUint64Array)
            return serializeTypedArray("m", value);
          if (value instanceof DataView) return serializeTypedArray("V", value);
          if ("function" === typeof Blob && value instanceof Blob)
            return (
              null === formData && (formData = new FormData()),
              (key = nextPartId++),
              formData.append(formFieldPrefix + key, value),
              "$B" + key.toString(16)
            );
          if ((parentReference = getIteratorFn(value)))
            return (
              (parentReference = parentReference.call(value)),
              parentReference === value
                ? ((key = nextPartId++),
                  (parentReference = serializeModel(
                    Array.from(parentReference),
                    key
                  )),
                  null === formData && (formData = new FormData()),
                  formData.append(formFieldPrefix + key, parentReference),
                  "$i" + key.toString(16))
                : Array.from(parentReference)
            );
          if (
            "function" === typeof ReadableStream &&
            value instanceof ReadableStream
          )
            return serializeReadableStream(value);
          parentReference = value[ASYNC_ITERATOR];
          if ("function" === typeof parentReference)
            return serializeAsyncIterable(value, parentReference.call(value));
          parentReference = getPrototypeOf(value);
          if (
            parentReference !== ObjectPrototype &&
            (null === parentReference ||
              null !== getPrototypeOf(parentReference))
          ) {
            if (void 0 === temporaryReferences)
              throw Error(
                "Only plain objects, and a few built-ins, can be passed to Server Functions. Classes or null prototypes are not supported." +
                  describeObjectForErrorMessage(this, key)
              );
            return "$T";
          }
          value.$$typeof === REACT_CONTEXT_TYPE
            ? console.error(
                "React Context Providers cannot be passed to Server Functions from the Client.%s",
                describeObjectForErrorMessage(this, key)
              )
            : "Object" !== objectName(value)
              ? console.error(
                  "Only plain objects can be passed to Server Functions from the Client. %s objects are not supported.%s",
                  objectName(value),
                  describeObjectForErrorMessage(this, key)
                )
              : isSimpleObject(value)
                ? Object.getOwnPropertySymbols &&
                  ((parentReference = Object.getOwnPropertySymbols(value)),
                  0 < parentReference.length &&
                    console.error(
                      "Only plain objects can be passed to Server Functions from the Client. Objects with symbol properties like %s are not supported.%s",
                      parentReference[0].description,
                      describeObjectForErrorMessage(this, key)
                    ))
                : console.error(
                    "Only plain objects can be passed to Server Functions from the Client. Classes or other objects with methods are not supported.%s",
                    describeObjectForErrorMessage(this, key)
                  );
          return value;
        }
        if ("string" === typeof value) {
          if ("Z" === value[value.length - 1] && this[key] instanceof Date)
            return "$D" + value;
          key = "$" === value[0] ? "$" + value : value;
          return key;
        }
        if ("boolean" === typeof value) return value;
        if ("number" === typeof value) return serializeNumber(value);
        if ("undefined" === typeof value) return "$undefined";
        if ("function" === typeof value) {
          parentReference = knownServerReferences.get(value);
          if (void 0 !== parentReference)
            return (
              (key = JSON.stringify(
                { id: parentReference.id, bound: parentReference.bound },
                resolveToJSON
              )),
              null === formData && (formData = new FormData()),
              (parentReference = nextPartId++),
              formData.set(formFieldPrefix + parentReference, key),
              "$F" + parentReference.toString(16)
            );
          if (
            void 0 !== temporaryReferences &&
            -1 === key.indexOf(":") &&
            ((parentReference = writtenObjects.get(this)),
            void 0 !== parentReference)
          )
            return (
              temporaryReferences.set(parentReference + ":" + key, value), "$T"
            );
          throw Error(
            "Client Functions cannot be passed directly to Server Functions. Only Functions passed from the Server can be passed back again."
          );
        }
        if ("symbol" === typeof value) {
          if (
            void 0 !== temporaryReferences &&
            -1 === key.indexOf(":") &&
            ((parentReference = writtenObjects.get(this)),
            void 0 !== parentReference)
          )
            return (
              temporaryReferences.set(parentReference + ":" + key, value), "$T"
            );
          throw Error(
            "Symbols cannot be passed to a Server Function without a temporary reference set. Pass a TemporaryReferenceSet to the options." +
              describeObjectForErrorMessage(this, key)
          );
        }
        if ("bigint" === typeof value) return "$n" + value.toString(10);
        throw Error(
          "Type " +
            typeof value +
            " is not supported as an argument to a Server Function."
        );
      }
      function serializeModel(model, id) {
        "object" === typeof model &&
          null !== model &&
          ((id = "$" + id.toString(16)),
          writtenObjects.set(model, id),
          void 0 !== temporaryReferences && temporaryReferences.set(id, model));
        modelRoot = model;
        return JSON.stringify(model, resolveToJSON);
      }
      var nextPartId = 1,
        pendingParts = 0,
        formData = null,
        writtenObjects = new WeakMap(),
        modelRoot = root,
        json = serializeModel(root, 0);
      null === formData
        ? resolve(json)
        : (formData.set(formFieldPrefix + "0", json),
          0 === pendingParts && resolve(formData));
      return function () {
        0 < pendingParts &&
          ((pendingParts = 0),
          null === formData ? resolve(json) : resolve(formData));
      };
    }
    function encodeFormData(reference) {
      var resolve,
        reject,
        thenable = new Promise(function (res, rej) {
          resolve = res;
          reject = rej;
        });
      processReply(
        reference,
        "",
        void 0,
        function (body) {
          if ("string" === typeof body) {
            var data = new FormData();
            data.append("0", body);
            body = data;
          }
          thenable.status = "fulfilled";
          thenable.value = body;
          resolve(body);
        },
        function (e) {
          thenable.status = "rejected";
          thenable.reason = e;
          reject(e);
        }
      );
      return thenable;
    }
    function defaultEncodeFormAction(identifierPrefix) {
      var referenceClosure = knownServerReferences.get(this);
      if (!referenceClosure)
        throw Error(
          "Tried to encode a Server Action from a different instance than the encoder is from. This is a bug in React."
        );
      var data = null;
      if (null !== referenceClosure.bound) {
        data = boundCache.get(referenceClosure);
        data ||
          ((data = encodeFormData({
            id: referenceClosure.id,
            bound: referenceClosure.bound
          })),
          boundCache.set(referenceClosure, data));
        if ("rejected" === data.status) throw data.reason;
        if ("fulfilled" !== data.status) throw data;
        referenceClosure = data.value;
        var prefixedData = new FormData();
        referenceClosure.forEach(function (value, key) {
          prefixedData.append("$ACTION_" + identifierPrefix + ":" + key, value);
        });
        data = prefixedData;
        referenceClosure = "$ACTION_REF_" + identifierPrefix;
      } else referenceClosure = "$ACTION_ID_" + referenceClosure.id;
      return {
        name: referenceClosure,
        method: "POST",
        encType: "multipart/form-data",
        data: data
      };
    }
    function isSignatureEqual(referenceId, numberOfBoundArgs) {
      var referenceClosure = knownServerReferences.get(this);
      if (!referenceClosure)
        throw Error(
          "Tried to encode a Server Action from a different instance than the encoder is from. This is a bug in React."
        );
      if (referenceClosure.id !== referenceId) return !1;
      var boundPromise = referenceClosure.bound;
      if (null === boundPromise) return 0 === numberOfBoundArgs;
      switch (boundPromise.status) {
        case "fulfilled":
          return boundPromise.value.length === numberOfBoundArgs;
        case "pending":
          throw boundPromise;
        case "rejected":
          throw boundPromise.reason;
        default:
          throw (
            ("string" !== typeof boundPromise.status &&
              ((boundPromise.status = "pending"),
              boundPromise.then(
                function (boundArgs) {
                  boundPromise.status = "fulfilled";
                  boundPromise.value = boundArgs;
                },
                function (error) {
                  boundPromise.status = "rejected";
                  boundPromise.reason = error;
                }
              )),
            boundPromise)
          );
      }
    }
    function createFakeServerFunction(
      name,
      filename,
      sourceMap,
      line,
      col,
      environmentName,
      innerFunction
    ) {
      name || (name = "<anonymous>");
      var encodedName = JSON.stringify(name);
      1 >= line
        ? ((line = encodedName.length + 7),
          (col =
            "s=>({" +
            encodedName +
            " ".repeat(col < line ? 0 : col - line) +
            ":(...args) => s(...args)})\n/* This module is a proxy to a Server Action. Turn on Source Maps to see the server source. */"))
        : (col =
            "/* This module is a proxy to a Server Action. Turn on Source Maps to see the server source. */" +
            "\n".repeat(line - 2) +
            "server=>({" +
            encodedName +
            ":\n" +
            " ".repeat(1 > col ? 0 : col - 1) +
            "(...args) => server(...args)})");
      filename.startsWith("/") && (filename = "file://" + filename);
      sourceMap
        ? ((col +=
            "\n//# sourceURL=about://React/" +
            encodeURIComponent(environmentName) +
            "/" +
            encodeURI(filename) +
            "?s" +
            fakeServerFunctionIdx++),
          (col += "\n//# sourceMappingURL=" + sourceMap))
        : filename && (col += "\n//# sourceURL=" + filename);
      try {
        return (0, eval)(col)(innerFunction)[name];
      } catch (x) {
        return innerFunction;
      }
    }
    function registerBoundServerReference(
      reference,
      id,
      bound,
      encodeFormAction
    ) {
      knownServerReferences.has(reference) ||
        (knownServerReferences.set(reference, {
          id: id,
          originalBind: reference.bind,
          bound: bound
        }),
        Object.defineProperties(reference, {
          $$FORM_ACTION: {
            value:
              void 0 === encodeFormAction
                ? defaultEncodeFormAction
                : function () {
                    var referenceClosure = knownServerReferences.get(this);
                    if (!referenceClosure)
                      throw Error(
                        "Tried to encode a Server Action from a different instance than the encoder is from. This is a bug in React."
                      );
                    var boundPromise = referenceClosure.bound;
                    null === boundPromise &&
                      (boundPromise = Promise.resolve([]));
                    return encodeFormAction(referenceClosure.id, boundPromise);
                  }
          },
          $$IS_SIGNATURE_EQUAL: { value: isSignatureEqual },
          bind: { value: bind }
        }));
    }
    function bind() {
      var referenceClosure = knownServerReferences.get(this);
      if (!referenceClosure) return FunctionBind.apply(this, arguments);
      var newFn = referenceClosure.originalBind.apply(this, arguments);
      null != arguments[0] &&
        console.error(
          'Cannot bind "this" of a Server Action. Pass null or undefined as the first argument to .bind().'
        );
      var args = ArraySlice.call(arguments, 1),
        boundPromise = null;
      boundPromise =
        null !== referenceClosure.bound
          ? Promise.resolve(referenceClosure.bound).then(function (boundArgs) {
              return boundArgs.concat(args);
            })
          : Promise.resolve(args);
      knownServerReferences.set(newFn, {
        id: referenceClosure.id,
        originalBind: newFn.bind,
        bound: boundPromise
      });
      Object.defineProperties(newFn, {
        $$FORM_ACTION: { value: this.$$FORM_ACTION },
        $$IS_SIGNATURE_EQUAL: { value: isSignatureEqual },
        bind: { value: bind }
      });
      return newFn;
    }
    function createBoundServerReference(
      metaData,
      callServer,
      encodeFormAction,
      findSourceMapURL
    ) {
      function action() {
        var args = Array.prototype.slice.call(arguments);
        return bound
          ? "fulfilled" === bound.status
            ? callServer(id, bound.value.concat(args))
            : Promise.resolve(bound).then(function (boundArgs) {
                return callServer(id, boundArgs.concat(args));
              })
          : callServer(id, args);
      }
      var id = metaData.id,
        bound = metaData.bound,
        location = metaData.location;
      if (location) {
        var functionName = metaData.name || "",
          filename = location[1],
          line = location[2];
        location = location[3];
        metaData = metaData.env || "Server";
        findSourceMapURL =
          null == findSourceMapURL
            ? null
            : findSourceMapURL(filename, metaData);
        action = createFakeServerFunction(
          functionName,
          filename,
          findSourceMapURL,
          line,
          location,
          metaData,
          action
        );
      }
      registerBoundServerReference(action, id, bound, encodeFormAction);
      return action;
    }
    function parseStackLocation(error) {
      error = error.stack;
      error.startsWith("Error: react-stack-top-frame\n") &&
        (error = error.slice(29));
      var endOfFirst = error.indexOf("\n");
      if (-1 !== endOfFirst) {
        var endOfSecond = error.indexOf("\n", endOfFirst + 1);
        endOfFirst =
          -1 === endOfSecond
            ? error.slice(endOfFirst + 1)
            : error.slice(endOfFirst + 1, endOfSecond);
      } else endOfFirst = error;
      error = v8FrameRegExp.exec(endOfFirst);
      if (
        !error &&
        ((error = jscSpiderMonkeyFrameRegExp.exec(endOfFirst)), !error)
      )
        return null;
      endOfFirst = error[1] || "";
      "<anonymous>" === endOfFirst && (endOfFirst = "");
      endOfSecond = error[2] || error[5] || "";
      "<anonymous>" === endOfSecond && (endOfSecond = "");
      return [
        endOfFirst,
        endOfSecond,
        +(error[3] || error[6]),
        +(error[4] || error[7])
      ];
    }
    function getComponentNameFromType(type) {
      if (null == type) return null;
      if ("function" === typeof type)
        return type.$$typeof === REACT_CLIENT_REFERENCE
          ? null
          : type.displayName || type.name || null;
      if ("string" === typeof type) return type;
      switch (type) {
        case REACT_FRAGMENT_TYPE:
          return "Fragment";
        case REACT_PROFILER_TYPE:
          return "Profiler";
        case REACT_STRICT_MODE_TYPE:
          return "StrictMode";
        case REACT_SUSPENSE_TYPE:
          return "Suspense";
        case REACT_SUSPENSE_LIST_TYPE:
          return "SuspenseList";
        case REACT_ACTIVITY_TYPE:
          return "Activity";
      }
      if ("object" === typeof type)
        switch (
          ("number" === typeof type.tag &&
            console.error(
              "Received an unexpected object in getComponentNameFromType(). This is likely a bug in React. Please file an issue."
            ),
          type.$$typeof)
        ) {
          case REACT_PORTAL_TYPE:
            return "Portal";
          case REACT_CONTEXT_TYPE:
            return type.displayName || "Context";
          case REACT_CONSUMER_TYPE:
            return (type._context.displayName || "Context") + ".Consumer";
          case REACT_FORWARD_REF_TYPE:
            var innerType = type.render;
            type = type.displayName;
            type ||
              ((type = innerType.displayName || innerType.name || ""),
              (type = "" !== type ? "ForwardRef(" + type + ")" : "ForwardRef"));
            return type;
          case REACT_MEMO_TYPE:
            return (
              (innerType = type.displayName || null),
              null !== innerType
                ? innerType
                : getComponentNameFromType(type.type) || "Memo"
            );
          case REACT_LAZY_TYPE:
            innerType = type._payload;
            type = type._init;
            try {
              return getComponentNameFromType(type(innerType));
            } catch (x) {}
        }
      return null;
    }
    function ReactPromise(status, value, reason) {
      this.status = status;
      this.value = value;
      this.reason = reason;
      this._debugChunk = null;
      this._debugInfo = [];
    }
    function unwrapWeakResponse(weakResponse) {
      weakResponse = weakResponse.weak.deref();
      if (void 0 === weakResponse)
        throw Error(
          "We did not expect to receive new data after GC:ing the response."
        );
      return weakResponse;
    }
    function closeDebugChannel(debugChannel) {
      debugChannel.callback && debugChannel.callback("");
    }
    function readChunk(chunk) {
      switch (chunk.status) {
        case "resolved_model":
          initializeModelChunk(chunk);
          break;
        case "resolved_module":
          initializeModuleChunk(chunk);
      }
      switch (chunk.status) {
        case "fulfilled":
          return chunk.value;
        case "pending":
        case "blocked":
        case "halted":
          throw chunk;
        default:
          throw chunk.reason;
      }
    }
    function getRoot(weakResponse) {
      weakResponse = unwrapWeakResponse(weakResponse);
      return getChunk(weakResponse, 0);
    }
    function createPendingChunk(response) {
      0 === response._pendingChunks++ &&
        ((response._weakResponse.response = response),
        null !== response._pendingInitialRender &&
          (clearTimeout(response._pendingInitialRender),
          (response._pendingInitialRender = null)));
      return new ReactPromise("pending", null, null);
    }
    function releasePendingChunk(response, chunk) {
      "pending" === chunk.status &&
        0 === --response._pendingChunks &&
        ((response._weakResponse.response = null),
        (response._pendingInitialRender = setTimeout(
          flushInitialRenderPerformance.bind(null, response),
          100
        )));
    }
    function wakeChunk(listeners, value, chunk) {
      for (var i = 0; i < listeners.length; i++) {
        var listener = listeners[i];
        "function" === typeof listener
          ? listener(value)
          : fulfillReference(listener, value, chunk);
      }
    }
    function rejectChunk(listeners, error) {
      for (var i = 0; i < listeners.length; i++) {
        var listener = listeners[i];
        "function" === typeof listener
          ? listener(error)
          : rejectReference(listener, error);
      }
    }
    function resolveBlockedCycle(resolvedChunk, reference) {
      var referencedChunk = reference.handler.chunk;
      if (null === referencedChunk) return null;
      if (referencedChunk === resolvedChunk) return reference.handler;
      reference = referencedChunk.value;
      if (null !== reference)
        for (
          referencedChunk = 0;
          referencedChunk < reference.length;
          referencedChunk++
        ) {
          var listener = reference[referencedChunk];
          if (
            "function" !== typeof listener &&
            ((listener = resolveBlockedCycle(resolvedChunk, listener)),
            null !== listener)
          )
            return listener;
        }
      return null;
    }
    function wakeChunkIfInitialized(chunk, resolveListeners, rejectListeners) {
      switch (chunk.status) {
        case "fulfilled":
          wakeChunk(resolveListeners, chunk.value, chunk);
          break;
        case "blocked":
          for (var i = 0; i < resolveListeners.length; i++) {
            var listener = resolveListeners[i];
            if ("function" !== typeof listener) {
              var cyclicHandler = resolveBlockedCycle(chunk, listener);
              null !== cyclicHandler &&
                (fulfillReference(listener, cyclicHandler.value, chunk),
                resolveListeners.splice(i, 1),
                i--,
                null !== rejectListeners &&
                  ((listener = rejectListeners.indexOf(listener)),
                  -1 !== listener && rejectListeners.splice(listener, 1)));
            }
          }
        case "pending":
          if (chunk.value)
            for (i = 0; i < resolveListeners.length; i++)
              chunk.value.push(resolveListeners[i]);
          else chunk.value = resolveListeners;
          if (chunk.reason) {
            if (rejectListeners)
              for (
                resolveListeners = 0;
                resolveListeners < rejectListeners.length;
                resolveListeners++
              )
                chunk.reason.push(rejectListeners[resolveListeners]);
          } else chunk.reason = rejectListeners;
          break;
        case "rejected":
          rejectListeners && rejectChunk(rejectListeners, chunk.reason);
      }
    }
    function triggerErrorOnChunk(response, chunk, error) {
      if ("pending" !== chunk.status && "blocked" !== chunk.status)
        chunk.reason.error(error);
      else {
        releasePendingChunk(response, chunk);
        var listeners = chunk.reason;
        if ("pending" === chunk.status && null != chunk._debugChunk) {
          var prevHandler = initializingHandler,
            prevChunk = initializingChunk;
          initializingHandler = null;
          chunk.status = "blocked";
          chunk.value = null;
          chunk.reason = null;
          initializingChunk = chunk;
          try {
            initializeDebugChunk(response, chunk), (chunk._debugChunk = null);
          } finally {
            (initializingHandler = prevHandler),
              (initializingChunk = prevChunk);
          }
        }
        chunk.status = "rejected";
        chunk.reason = error;
        null !== listeners && rejectChunk(listeners, error);
      }
    }
    function createResolvedModelChunk(response, value) {
      return new ReactPromise("resolved_model", value, response);
    }
    function createResolvedIteratorResultChunk(response, value, done) {
      return new ReactPromise(
        "resolved_model",
        (done ? '{"done":true,"value":' : '{"done":false,"value":') +
          value +
          "}",
        response
      );
    }
    function resolveIteratorResultChunk(response, chunk, value, done) {
      resolveModelChunk(
        response,
        chunk,
        (done ? '{"done":true,"value":' : '{"done":false,"value":') +
          value +
          "}"
      );
    }
    function resolveModelChunk(response, chunk, value) {
      if ("pending" !== chunk.status) chunk.reason.enqueueModel(value);
      else {
        releasePendingChunk(response, chunk);
        var resolveListeners = chunk.value,
          rejectListeners = chunk.reason;
        chunk.status = "resolved_model";
        chunk.value = value;
        chunk.reason = response;
        null !== resolveListeners &&
          (initializeModelChunk(chunk),
          wakeChunkIfInitialized(chunk, resolveListeners, rejectListeners));
      }
    }
    function resolveModuleChunk(response, chunk, value) {
      if ("pending" === chunk.status || "blocked" === chunk.status) {
        releasePendingChunk(response, chunk);
        response = chunk.value;
        var rejectListeners = chunk.reason;
        chunk.status = "resolved_module";
        chunk.value = value;
        null !== response &&
          (initializeModuleChunk(chunk),
          wakeChunkIfInitialized(chunk, response, rejectListeners));
      }
    }
    function initializeDebugChunk(response, chunk) {
      var debugChunk = chunk._debugChunk;
      if (null !== debugChunk) {
        var debugInfo = chunk._debugInfo;
        try {
          if ("resolved_model" === debugChunk.status) {
            for (
              var idx = debugInfo.length, c = debugChunk._debugChunk;
              null !== c;

            )
              "fulfilled" !== c.status && idx++, (c = c._debugChunk);
            initializeModelChunk(debugChunk);
            switch (debugChunk.status) {
              case "fulfilled":
                debugInfo[idx] = initializeDebugInfo(
                  response,
                  debugChunk.value
                );
                break;
              case "blocked":
              case "pending":
                waitForReference(
                  debugChunk,
                  debugInfo,
                  "" + idx,
                  response,
                  initializeDebugInfo,
                  [""],
                  !0
                );
                break;
              default:
                throw debugChunk.reason;
            }
          } else
            switch (debugChunk.status) {
              case "fulfilled":
                break;
              case "blocked":
              case "pending":
                waitForReference(
                  debugChunk,
                  {},
                  "debug",
                  response,
                  initializeDebugInfo,
                  [""],
                  !0
                );
                break;
              default:
                throw debugChunk.reason;
            }
        } catch (error) {
          triggerErrorOnChunk(response, chunk, error);
        }
      }
    }
    function initializeModelChunk(chunk) {
      var prevHandler = initializingHandler,
        prevChunk = initializingChunk;
      initializingHandler = null;
      var resolvedModel = chunk.value,
        response = chunk.reason;
      chunk.status = "blocked";
      chunk.value = null;
      chunk.reason = null;
      initializingChunk = chunk;
      initializeDebugChunk(response, chunk);
      chunk._debugChunk = null;
      try {
        var value = JSON.parse(resolvedModel, response._fromJSON),
          resolveListeners = chunk.value;
        null !== resolveListeners &&
          ((chunk.value = null),
          (chunk.reason = null),
          wakeChunk(resolveListeners, value, chunk));
        if (null !== initializingHandler) {
          if (initializingHandler.errored) throw initializingHandler.reason;
          if (0 < initializingHandler.deps) {
            initializingHandler.value = value;
            initializingHandler.chunk = chunk;
            return;
          }
        }
        chunk.status = "fulfilled";
        chunk.value = value;
      } catch (error) {
        (chunk.status = "rejected"), (chunk.reason = error);
      } finally {
        (initializingHandler = prevHandler), (initializingChunk = prevChunk);
      }
    }
    function initializeModuleChunk(chunk) {
      try {
        var value = requireModule(chunk.value);
        chunk.status = "fulfilled";
        chunk.value = value;
      } catch (error) {
        (chunk.status = "rejected"), (chunk.reason = error);
      }
    }
    function reportGlobalError(weakResponse, error) {
      if (void 0 !== weakResponse.weak.deref()) {
        var response = unwrapWeakResponse(weakResponse);
        response._closed = !0;
        response._closedReason = error;
        response._chunks.forEach(function (chunk) {
          "pending" === chunk.status &&
            triggerErrorOnChunk(response, chunk, error);
        });
        weakResponse = response._debugChannel;
        void 0 !== weakResponse &&
          (closeDebugChannel(weakResponse),
          (response._debugChannel = void 0),
          null !== debugChannelRegistry &&
            debugChannelRegistry.unregister(response));
      }
    }
    function nullRefGetter() {
      return null;
    }
    function getTaskName(type) {
      if (type === REACT_FRAGMENT_TYPE) return "<>";
      if ("function" === typeof type) return '"use client"';
      if (
        "object" === typeof type &&
        null !== type &&
        type.$$typeof === REACT_LAZY_TYPE
      )
        return type._init === readChunk ? '"use client"' : "<...>";
      try {
        var name = getComponentNameFromType(type);
        return name ? "<" + name + ">" : "<...>";
      } catch (x) {
        return "<...>";
      }
    }
    function initializeElement(response, element, lazyType) {
      var stack = element._debugStack,
        owner = element._owner;
      null === owner && (element._owner = response._debugRootOwner);
      var env = response._rootEnvironmentName;
      null !== owner && null != owner.env && (env = owner.env);
      var normalizedStackTrace = null;
      null === owner && null != response._debugRootStack
        ? (normalizedStackTrace = response._debugRootStack)
        : null !== stack &&
          (normalizedStackTrace = createFakeJSXCallStackInDEV(
            response,
            stack,
            env
          ));
      element._debugStack = normalizedStackTrace;
      normalizedStackTrace = null;
      supportsCreateTask &&
        null !== stack &&
        ((normalizedStackTrace = console.createTask.bind(
          console,
          getTaskName(element.type)
        )),
        (stack = buildFakeCallStack(
          response,
          stack,
          env,
          !1,
          normalizedStackTrace
        )),
        (env = null === owner ? null : initializeFakeTask(response, owner)),
        null === env
          ? ((env = response._debugRootTask),
            (normalizedStackTrace = null != env ? env.run(stack) : stack()))
          : (normalizedStackTrace = env.run(stack)));
      element._debugTask = normalizedStackTrace;
      null !== owner && initializeFakeStack(response, owner);
      lazyType &&
        lazyType._store &&
        lazyType._store.validated &&
        !element._store.validated &&
        (element._store.validated = lazyType._store.validated);
      Object.freeze(element.props);
    }
    function createLazyChunkWrapper(chunk, validated) {
      var lazyType = {
        $$typeof: REACT_LAZY_TYPE,
        _payload: chunk,
        _init: readChunk
      };
      lazyType._debugInfo = chunk._debugInfo;
      lazyType._store = { validated: validated };
      return lazyType;
    }
    function getChunk(response, id) {
      var chunks = response._chunks,
        chunk = chunks.get(id);
      chunk ||
        ((chunk = response._closed
          ? new ReactPromise("rejected", null, response._closedReason)
          : createPendingChunk(response)),
        chunks.set(id, chunk));
      return chunk;
    }
    function fulfillReference(reference, value, fulfilledChunk) {
      for (
        var response = reference.response,
          handler = reference.handler,
          parentObject = reference.parentObject,
          key = reference.key,
          map = reference.map,
          path = reference.path,
          i = 1;
        i < path.length;
        i++
      ) {
        for (
          ;
          "object" === typeof value &&
          null !== value &&
          value.$$typeof === REACT_LAZY_TYPE;

        )
          if (((value = value._payload), value === handler.chunk))
            value = handler.value;
          else {
            switch (value.status) {
              case "resolved_model":
                initializeModelChunk(value);
                break;
              case "resolved_module":
                initializeModuleChunk(value);
            }
            switch (value.status) {
              case "fulfilled":
                value = value.value;
                continue;
              case "blocked":
                var cyclicHandler = resolveBlockedCycle(value, reference);
                if (null !== cyclicHandler) {
                  value = cyclicHandler.value;
                  continue;
                }
              case "pending":
                path.splice(0, i - 1);
                null === value.value
                  ? (value.value = [reference])
                  : value.value.push(reference);
                null === value.reason
                  ? (value.reason = [reference])
                  : value.reason.push(reference);
                return;
              case "halted":
                return;
              default:
                rejectReference(reference, value.reason);
                return;
            }
          }
        value = value[path[i]];
      }
      for (
        ;
        "object" === typeof value &&
        null !== value &&
        value.$$typeof === REACT_LAZY_TYPE;

      )
        if (((path = value._payload), path === handler.chunk))
          value = handler.value;
        else {
          switch (path.status) {
            case "resolved_model":
              initializeModelChunk(path);
              break;
            case "resolved_module":
              initializeModuleChunk(path);
          }
          switch (path.status) {
            case "fulfilled":
              value = path.value;
              continue;
          }
          break;
        }
      response = map(response, value, parentObject, key);
      parentObject[key] = response;
      "" === key && null === handler.value && (handler.value = response);
      if (
        parentObject[0] === REACT_ELEMENT_TYPE &&
        "object" === typeof handler.value &&
        null !== handler.value &&
        handler.value.$$typeof === REACT_ELEMENT_TYPE
      )
        switch (((reference = handler.value), key)) {
          case "3":
            transferReferencedDebugInfo(
              handler.chunk,
              fulfilledChunk,
              response
            );
            reference.props = response;
            break;
          case "4":
            reference._owner = response;
            break;
          case "5":
            reference._debugStack = response;
            break;
          default:
            transferReferencedDebugInfo(
              handler.chunk,
              fulfilledChunk,
              response
            );
        }
      else
        reference.isDebug ||
          transferReferencedDebugInfo(handler.chunk, fulfilledChunk, response);
      handler.deps--;
      0 === handler.deps &&
        ((fulfilledChunk = handler.chunk),
        null !== fulfilledChunk &&
          "blocked" === fulfilledChunk.status &&
          ((key = fulfilledChunk.value),
          (fulfilledChunk.status = "fulfilled"),
          (fulfilledChunk.value = handler.value),
          (fulfilledChunk.reason = handler.reason),
          null !== key && wakeChunk(key, handler.value, fulfilledChunk)));
    }
    function rejectReference(reference, error) {
      var handler = reference.handler;
      reference = reference.response;
      if (!handler.errored) {
        var blockedValue = handler.value;
        handler.errored = !0;
        handler.value = null;
        handler.reason = error;
        handler = handler.chunk;
        if (null !== handler && "blocked" === handler.status) {
          if (
            "object" === typeof blockedValue &&
            null !== blockedValue &&
            blockedValue.$$typeof === REACT_ELEMENT_TYPE
          ) {
            var erroredComponent = {
              name: getComponentNameFromType(blockedValue.type) || "",
              owner: blockedValue._owner
            };
            erroredComponent.debugStack = blockedValue._debugStack;
            supportsCreateTask &&
              (erroredComponent.debugTask = blockedValue._debugTask);
            handler._debugInfo.push(erroredComponent);
          }
          triggerErrorOnChunk(reference, handler, error);
        }
      }
    }
    function waitForReference(
      referencedChunk,
      parentObject,
      key,
      response,
      map,
      path,
      isAwaitingDebugInfo
    ) {
      if (
        !(
          (void 0 !== response._debugChannel &&
            response._debugChannel.hasReadable) ||
          "pending" !== referencedChunk.status ||
          parentObject[0] !== REACT_ELEMENT_TYPE ||
          ("4" !== key && "5" !== key)
        )
      )
        return null;
      if (initializingHandler) {
        var handler = initializingHandler;
        handler.deps++;
      } else
        handler = initializingHandler = {
          parent: null,
          chunk: null,
          value: null,
          reason: null,
          deps: 1,
          errored: !1
        };
      parentObject = {
        response: response,
        handler: handler,
        parentObject: parentObject,
        key: key,
        map: map,
        path: path
      };
      parentObject.isDebug = isAwaitingDebugInfo;
      null === referencedChunk.value
        ? (referencedChunk.value = [parentObject])
        : referencedChunk.value.push(parentObject);
      null === referencedChunk.reason
        ? (referencedChunk.reason = [parentObject])
        : referencedChunk.reason.push(parentObject);
      return null;
    }
    function loadServerReference(response, metaData, parentObject, key) {
      if (!response._serverReferenceConfig)
        return createBoundServerReference(
          metaData,
          response._callServer,
          response._encodeFormAction,
          response._debugFindSourceMapURL
        );
      var serverReference = resolveServerReference(
          response._serverReferenceConfig,
          metaData.id
        ),
        promise = preloadModule(serverReference);
      if (promise)
        metaData.bound && (promise = Promise.all([promise, metaData.bound]));
      else if (metaData.bound) promise = Promise.resolve(metaData.bound);
      else
        return (
          (promise = requireModule(serverReference)),
          registerBoundServerReference(
            promise,
            metaData.id,
            metaData.bound,
            response._encodeFormAction
          ),
          promise
        );
      if (initializingHandler) {
        var handler = initializingHandler;
        handler.deps++;
      } else
        handler = initializingHandler = {
          parent: null,
          chunk: null,
          value: null,
          reason: null,
          deps: 1,
          errored: !1
        };
      promise.then(
        function () {
          var resolvedValue = requireModule(serverReference);
          if (metaData.bound) {
            var boundArgs = metaData.bound.value.slice(0);
            boundArgs.unshift(null);
            resolvedValue = resolvedValue.bind.apply(resolvedValue, boundArgs);
          }
          registerBoundServerReference(
            resolvedValue,
            metaData.id,
            metaData.bound,
            response._encodeFormAction
          );
          parentObject[key] = resolvedValue;
          "" === key &&
            null === handler.value &&
            (handler.value = resolvedValue);
          if (
            parentObject[0] === REACT_ELEMENT_TYPE &&
            "object" === typeof handler.value &&
            null !== handler.value &&
            handler.value.$$typeof === REACT_ELEMENT_TYPE
          )
            switch (((boundArgs = handler.value), key)) {
              case "3":
                boundArgs.props = resolvedValue;
                break;
              case "4":
                boundArgs._owner = resolvedValue;
            }
          handler.deps--;
          0 === handler.deps &&
            ((resolvedValue = handler.chunk),
            null !== resolvedValue &&
              "blocked" === resolvedValue.status &&
              ((boundArgs = resolvedValue.value),
              (resolvedValue.status = "fulfilled"),
              (resolvedValue.value = handler.value),
              null !== boundArgs &&
                wakeChunk(boundArgs, handler.value, resolvedValue)));
        },
        function (error) {
          if (!handler.errored) {
            var blockedValue = handler.value;
            handler.errored = !0;
            handler.value = null;
            handler.reason = error;
            var chunk = handler.chunk;
            if (null !== chunk && "blocked" === chunk.status) {
              if (
                "object" === typeof blockedValue &&
                null !== blockedValue &&
                blockedValue.$$typeof === REACT_ELEMENT_TYPE
              ) {
                var erroredComponent = {
                  name: getComponentNameFromType(blockedValue.type) || "",
                  owner: blockedValue._owner
                };
                erroredComponent.debugStack = blockedValue._debugStack;
                supportsCreateTask &&
                  (erroredComponent.debugTask = blockedValue._debugTask);
                chunk._debugInfo.push(erroredComponent);
              }
              triggerErrorOnChunk(response, chunk, error);
            }
          }
        }
      );
      return null;
    }
    function transferReferencedDebugInfo(
      parentChunk,
      referencedChunk,
      referencedValue
    ) {
      referencedChunk = referencedChunk._debugInfo;
      if (
        "object" === typeof referencedValue &&
        null !== referencedValue &&
        (isArrayImpl(referencedValue) ||
          "function" === typeof referencedValue[ASYNC_ITERATOR] ||
          referencedValue.$$typeof === REACT_ELEMENT_TYPE)
      ) {
        var existingDebugInfo = referencedValue._debugInfo;
        null == existingDebugInfo
          ? Object.defineProperty(referencedValue, "_debugInfo", {
              configurable: !1,
              enumerable: !1,
              writable: !0,
              value: referencedChunk.slice(0)
            })
          : existingDebugInfo.push.apply(existingDebugInfo, referencedChunk);
      }
      if (null !== parentChunk)
        for (
          parentChunk = parentChunk._debugInfo, referencedValue = 0;
          referencedValue < referencedChunk.length;
          ++referencedValue
        )
          (existingDebugInfo = referencedChunk[referencedValue]),
            null == existingDebugInfo.name &&
              parentChunk.push(existingDebugInfo);
    }
    function getOutlinedModel(response, reference, parentObject, key, map) {
      var path = reference.split(":");
      reference = parseInt(path[0], 16);
      reference = getChunk(response, reference);
      switch (reference.status) {
        case "resolved_model":
          initializeModelChunk(reference);
          break;
        case "resolved_module":
          initializeModuleChunk(reference);
      }
      switch (reference.status) {
        case "fulfilled":
          for (var value = reference.value, i = 1; i < path.length; i++) {
            for (
              ;
              "object" === typeof value &&
              null !== value &&
              value.$$typeof === REACT_LAZY_TYPE;

            ) {
              value = value._payload;
              switch (value.status) {
                case "resolved_model":
                  initializeModelChunk(value);
                  break;
                case "resolved_module":
                  initializeModuleChunk(value);
              }
              switch (value.status) {
                case "fulfilled":
                  value = value.value;
                  break;
                case "blocked":
                case "pending":
                  return waitForReference(
                    value,
                    parentObject,
                    key,
                    response,
                    map,
                    path.slice(i - 1),
                    !1
                  );
                case "halted":
                  return (
                    initializingHandler
                      ? ((parentObject = initializingHandler),
                        parentObject.deps++)
                      : (initializingHandler = {
                          parent: null,
                          chunk: null,
                          value: null,
                          reason: null,
                          deps: 1,
                          errored: !1
                        }),
                    null
                  );
                default:
                  return (
                    initializingHandler
                      ? ((initializingHandler.errored = !0),
                        (initializingHandler.value = null),
                        (initializingHandler.reason = value.reason))
                      : (initializingHandler = {
                          parent: null,
                          chunk: null,
                          value: null,
                          reason: value.reason,
                          deps: 0,
                          errored: !0
                        }),
                    null
                  );
              }
            }
            value = value[path[i]];
          }
          for (
            ;
            "object" === typeof value &&
            null !== value &&
            value.$$typeof === REACT_LAZY_TYPE;

          ) {
            path = value._payload;
            switch (path.status) {
              case "resolved_model":
                initializeModelChunk(path);
                break;
              case "resolved_module":
                initializeModuleChunk(path);
            }
            switch (path.status) {
              case "fulfilled":
                value = path.value;
                continue;
            }
            break;
          }
          response = map(response, value, parentObject, key);
          (parentObject[0] !== REACT_ELEMENT_TYPE ||
            ("4" !== key && "5" !== key)) &&
            transferReferencedDebugInfo(initializingChunk, reference, response);
          return response;
        case "pending":
        case "blocked":
          return waitForReference(
            reference,
            parentObject,
            key,
            response,
            map,
            path,
            !1
          );
        case "halted":
          return (
            initializingHandler
              ? ((parentObject = initializingHandler), parentObject.deps++)
              : (initializingHandler = {
                  parent: null,
                  chunk: null,
                  value: null,
                  reason: null,
                  deps: 1,
                  errored: !1
                }),
            null
          );
        default:
          return (
            initializingHandler
              ? ((initializingHandler.errored = !0),
                (initializingHandler.value = null),
                (initializingHandler.reason = reference.reason))
              : (initializingHandler = {
                  parent: null,
                  chunk: null,
                  value: null,
                  reason: reference.reason,
                  deps: 0,
                  errored: !0
                }),
            null
          );
      }
    }
    function createMap(response, model) {
      return new Map(model);
    }
    function createSet(response, model) {
      return new Set(model);
    }
    function createBlob(response, model) {
      return new Blob(model.slice(1), { type: model[0] });
    }
    function createFormData(response, model) {
      response = new FormData();
      for (var i = 0; i < model.length; i++)
        response.append(model[i][0], model[i][1]);
      return response;
    }
    function applyConstructor(response, model, parentObject) {
      Object.setPrototypeOf(parentObject, model.prototype);
    }
    function defineLazyGetter(response, chunk, parentObject, key) {
      Object.defineProperty(parentObject, key, {
        get: function () {
          "resolved_model" === chunk.status && initializeModelChunk(chunk);
          switch (chunk.status) {
            case "fulfilled":
              return chunk.value;
            case "rejected":
              throw chunk.reason;
          }
          return "This object has been omitted by React in the console log to avoid sending too much data from the server. Try logging smaller or more specific objects.";
        },
        enumerable: !0,
        configurable: !1
      });
      return null;
    }
    function extractIterator(response, model) {
      return model[Symbol.iterator]();
    }
    function createModel(response, model) {
      return model;
    }
    function getInferredFunctionApproximate(code) {
      code = code.startsWith("Object.defineProperty(")
        ? code.slice(22)
        : code.startsWith("(")
          ? code.slice(1)
          : code;
      if (code.startsWith("async function")) {
        var idx = code.indexOf("(", 14);
        if (-1 !== idx)
          return (
            (code = code.slice(14, idx).trim()),
            (0, eval)("({" + JSON.stringify(code) + ":async function(){}})")[
              code
            ]
          );
      } else if (code.startsWith("function")) {
        if (((idx = code.indexOf("(", 8)), -1 !== idx))
          return (
            (code = code.slice(8, idx).trim()),
            (0, eval)("({" + JSON.stringify(code) + ":function(){}})")[code]
          );
      } else if (
        code.startsWith("class") &&
        ((idx = code.indexOf("{", 5)), -1 !== idx)
      )
        return (
          (code = code.slice(5, idx).trim()),
          (0, eval)("({" + JSON.stringify(code) + ":class{}})")[code]
        );
      return function () {};
    }
    function parseModelString(response, parentObject, key, value) {
      if ("$" === value[0]) {
        if ("$" === value)
          return (
            null !== initializingHandler &&
              "0" === key &&
              (initializingHandler = {
                parent: initializingHandler,
                chunk: null,
                value: null,
                reason: null,
                deps: 0,
                errored: !1
              }),
            REACT_ELEMENT_TYPE
          );
        switch (value[1]) {
          case "$":
            return value.slice(1);
          case "L":
            return (
              (parentObject = parseInt(value.slice(2), 16)),
              (response = getChunk(response, parentObject)),
              createLazyChunkWrapper(response, 0)
            );
          case "@":
            return (
              (parentObject = parseInt(value.slice(2), 16)),
              getChunk(response, parentObject)
            );
          case "S":
            return Symbol.for(value.slice(2));
          case "F":
            var ref = value.slice(2);
            return getOutlinedModel(
              response,
              ref,
              parentObject,
              key,
              loadServerReference
            );
          case "T":
            parentObject = "$" + value.slice(2);
            response = response._tempRefs;
            if (null == response)
              throw Error(
                "Missing a temporary reference set but the RSC response returned a temporary reference. Pass a temporaryReference option with the set that was used with the reply."
              );
            return response.get(parentObject);
          case "Q":
            return (
              (ref = value.slice(2)),
              getOutlinedModel(response, ref, parentObject, key, createMap)
            );
          case "W":
            return (
              (ref = value.slice(2)),
              getOutlinedModel(response, ref, parentObject, key, createSet)
            );
          case "B":
            return (
              (ref = value.slice(2)),
              getOutlinedModel(response, ref, parentObject, key, createBlob)
            );
          case "K":
            return (
              (ref = value.slice(2)),
              getOutlinedModel(response, ref, parentObject, key, createFormData)
            );
          case "Z":
            return (
              (ref = value.slice(2)),
              getOutlinedModel(
                response,
                ref,
                parentObject,
                key,
                resolveErrorDev
              )
            );
          case "i":
            return (
              (ref = value.slice(2)),
              getOutlinedModel(
                response,
                ref,
                parentObject,
                key,
                extractIterator
              )
            );
          case "I":
            return Infinity;
          case "-":
            return "$-0" === value ? -0 : -Infinity;
          case "N":
            return NaN;
          case "u":
            return;
          case "D":
            return new Date(Date.parse(value.slice(2)));
          case "n":
            return BigInt(value.slice(2));
          case "P":
            return (
              (ref = value.slice(2)),
              getOutlinedModel(
                response,
                ref,
                parentObject,
                key,
                applyConstructor
              )
            );
          case "E":
            response = value.slice(2);
            try {
              if (!mightHaveStaticConstructor.test(response))
                return (0, eval)(response);
            } catch (x) {}
            try {
              if (
                ((ref = getInferredFunctionApproximate(response)),
                response.startsWith("Object.defineProperty("))
              ) {
                var idx = response.lastIndexOf(',"name",{value:"');
                if (-1 !== idx) {
                  var name = JSON.parse(
                    response.slice(idx + 16 - 1, response.length - 2)
                  );
                  Object.defineProperty(ref, "name", { value: name });
                }
              }
            } catch (_) {
              ref = function () {};
            }
            return ref;
          case "Y":
            if (
              2 < value.length &&
              (ref = response._debugChannel && response._debugChannel.callback)
            ) {
              if ("@" === value[2])
                return (
                  (parentObject = value.slice(3)),
                  (key = parseInt(parentObject, 16)),
                  response._chunks.has(key) || ref("P:" + parentObject),
                  getChunk(response, key)
                );
              value = value.slice(2);
              idx = parseInt(value, 16);
              response._chunks.has(idx) || ref("Q:" + value);
              ref = getChunk(response, idx);
              return "fulfilled" === ref.status
                ? ref.value
                : defineLazyGetter(response, ref, parentObject, key);
            }
            Object.defineProperty(parentObject, key, {
              get: function () {
                return "This object has been omitted by React in the console log to avoid sending too much data from the server. Try logging smaller or more specific objects.";
              },
              enumerable: !0,
              configurable: !1
            });
            return null;
          default:
            return (
              (ref = value.slice(1)),
              getOutlinedModel(response, ref, parentObject, key, createModel)
            );
        }
      }
      return value;
    }
    function missingCall() {
      throw Error(
        'Trying to call a function from "use server" but the callServer option was not implemented in your router runtime.'
      );
    }
    function ResponseInstance(
      bundlerConfig,
      serverReferenceConfig,
      moduleLoading,
      callServer,
      encodeFormAction,
      nonce,
      temporaryReferences,
      findSourceMapURL,
      replayConsole,
      environmentName,
      debugChannel
    ) {
      var chunks = new Map();
      this._bundlerConfig = bundlerConfig;
      this._serverReferenceConfig = serverReferenceConfig;
      this._moduleLoading = moduleLoading;
      this._callServer = void 0 !== callServer ? callServer : missingCall;
      this._encodeFormAction = encodeFormAction;
      this._nonce = nonce;
      this._chunks = chunks;
      this._stringDecoder = new TextDecoder();
      this._fromJSON = null;
      this._closed = !1;
      this._closedReason = null;
      this._tempRefs = temporaryReferences;
      this._pendingChunks = 0;
      this._weakResponse = { weak: new WeakRef(this), response: this };
      this._debugRootOwner = bundlerConfig =
        void 0 === ReactSharedInteralsServer ||
        null === ReactSharedInteralsServer.A
          ? null
          : ReactSharedInteralsServer.A.getOwner();
      this._debugRootStack =
        null !== bundlerConfig ? Error("react-stack-top-frame") : null;
      environmentName = void 0 === environmentName ? "Server" : environmentName;
      supportsCreateTask &&
        (this._debugRootTask = console.createTask(
          '"use ' + environmentName.toLowerCase() + '"'
        ));
      this._debugStartTime = performance.now();
      this._debugFindSourceMapURL = findSourceMapURL;
      this._debugChannel = debugChannel;
      this._blockedConsole = null;
      this._replayConsole = replayConsole;
      this._rootEnvironmentName = environmentName;
      debugChannel &&
        (null === debugChannelRegistry
          ? (closeDebugChannel(debugChannel), (this._debugChannel = void 0))
          : debugChannelRegistry.register(this, debugChannel, this));
      this._fromJSON = createFromJSONCallback(this);
    }
    function createStreamState(weakResponse, streamDebugValue) {
      var streamState = {
        _rowState: 0,
        _rowID: 0,
        _rowTag: 0,
        _rowLength: 0,
        _buffer: []
      };
      weakResponse = unwrapWeakResponse(weakResponse);
      var debugValuePromise = Promise.resolve(streamDebugValue);
      debugValuePromise.status = "fulfilled";
      debugValuePromise.value = streamDebugValue;
      streamState._debugInfo = {
        name: "RSC stream",
        start: weakResponse._debugStartTime,
        end: weakResponse._debugStartTime,
        byteSize: 0,
        value: debugValuePromise,
        owner: weakResponse._debugRootOwner,
        debugStack: weakResponse._debugRootStack,
        debugTask: weakResponse._debugRootTask
      };
      streamState._debugTargetChunkSize = MIN_CHUNK_SIZE;
      return streamState;
    }
    function incrementChunkDebugInfo(streamState, chunkLength) {
      var debugInfo = streamState._debugInfo,
        endTime = performance.now(),
        previousEndTime = debugInfo.end;
      chunkLength = debugInfo.byteSize + chunkLength;
      chunkLength > streamState._debugTargetChunkSize ||
      endTime > previousEndTime + 10
        ? ((streamState._debugInfo = {
            name: debugInfo.name,
            start: debugInfo.start,
            end: endTime,
            byteSize: chunkLength,
            value: debugInfo.value,
            owner: debugInfo.owner,
            debugStack: debugInfo.debugStack,
            debugTask: debugInfo.debugTask
          }),
          (streamState._debugTargetChunkSize = chunkLength + MIN_CHUNK_SIZE))
        : ((debugInfo.end = endTime), (debugInfo.byteSize = chunkLength));
    }
    function resolveChunkDebugInfo(streamState, chunk) {
      chunk._debugInfo.push({ awaited: streamState._debugInfo });
    }
    function resolveBuffer(response, id, buffer, streamState) {
      var chunks = response._chunks,
        chunk = chunks.get(id);
      chunk && "pending" !== chunk.status
        ? chunk.reason.enqueueValue(buffer)
        : (chunk && releasePendingChunk(response, chunk),
          (response = new ReactPromise("fulfilled", buffer, null)),
          resolveChunkDebugInfo(streamState, response),
          chunks.set(id, response));
    }
    function resolveModule(response, id, model, streamState) {
      var chunks = response._chunks,
        chunk = chunks.get(id);
      model = JSON.parse(model, response._fromJSON);
      var clientReference = resolveClientReference(
        response._bundlerConfig,
        model
      );
      if ((model = preloadModule(clientReference))) {
        if (chunk) {
          releasePendingChunk(response, chunk);
          var blockedChunk = chunk;
          blockedChunk.status = "blocked";
        } else
          (blockedChunk = new ReactPromise("blocked", null, null)),
            chunks.set(id, blockedChunk);
        resolveChunkDebugInfo(streamState, blockedChunk);
        model.then(
          function () {
            return resolveModuleChunk(response, blockedChunk, clientReference);
          },
          function (error) {
            return triggerErrorOnChunk(response, blockedChunk, error);
          }
        );
      } else
        chunk
          ? (resolveChunkDebugInfo(streamState, chunk),
            resolveModuleChunk(response, chunk, clientReference))
          : ((chunk = new ReactPromise(
              "resolved_module",
              clientReference,
              null
            )),
            resolveChunkDebugInfo(streamState, chunk),
            chunks.set(id, chunk));
    }
    function resolveStream(response, id, stream, controller, streamState) {
      var chunks = response._chunks,
        chunk = chunks.get(id);
      if (chunk) {
        if (
          (resolveChunkDebugInfo(streamState, chunk),
          "pending" === chunk.status)
        ) {
          releasePendingChunk(response, chunk);
          id = chunk.value;
          if (null != chunk._debugChunk) {
            streamState = initializingHandler;
            chunks = initializingChunk;
            initializingHandler = null;
            chunk.status = "blocked";
            chunk.value = null;
            chunk.reason = null;
            initializingChunk = chunk;
            try {
              if (
                (initializeDebugChunk(response, chunk),
                (chunk._debugChunk = null),
                null !== initializingHandler &&
                  !initializingHandler.errored &&
                  0 < initializingHandler.deps)
              ) {
                initializingHandler.value = stream;
                initializingHandler.reason = controller;
                initializingHandler.chunk = chunk;
                return;
              }
            } finally {
              (initializingHandler = streamState), (initializingChunk = chunks);
            }
          }
          chunk.status = "fulfilled";
          chunk.value = stream;
          chunk.reason = controller;
          null !== id && wakeChunk(id, chunk.value, chunk);
        }
      } else
        (response = new ReactPromise("fulfilled", stream, controller)),
          resolveChunkDebugInfo(streamState, response),
          chunks.set(id, response);
    }
    function startReadableStream(response, id, type, streamState) {
      var controller = null;
      type = new ReadableStream({
        type: type,
        start: function (c) {
          controller = c;
        }
      });
      var previousBlockedChunk = null;
      resolveStream(
        response,
        id,
        type,
        {
          enqueueValue: function (value) {
            null === previousBlockedChunk
              ? controller.enqueue(value)
              : previousBlockedChunk.then(function () {
                  controller.enqueue(value);
                });
          },
          enqueueModel: function (json) {
            if (null === previousBlockedChunk) {
              var chunk = createResolvedModelChunk(response, json);
              initializeModelChunk(chunk);
              "fulfilled" === chunk.status
                ? controller.enqueue(chunk.value)
                : (chunk.then(
                    function (v) {
                      return controller.enqueue(v);
                    },
                    function (e) {
                      return controller.error(e);
                    }
                  ),
                  (previousBlockedChunk = chunk));
            } else {
              chunk = previousBlockedChunk;
              var _chunk3 = createPendingChunk(response);
              _chunk3.then(
                function (v) {
                  return controller.enqueue(v);
                },
                function (e) {
                  return controller.error(e);
                }
              );
              previousBlockedChunk = _chunk3;
              chunk.then(function () {
                previousBlockedChunk === _chunk3 &&
                  (previousBlockedChunk = null);
                resolveModelChunk(response, _chunk3, json);
              });
            }
          },
          close: function () {
            if (null === previousBlockedChunk) controller.close();
            else {
              var blockedChunk = previousBlockedChunk;
              previousBlockedChunk = null;
              blockedChunk.then(function () {
                return controller.close();
              });
            }
          },
          error: function (error) {
            if (null === previousBlockedChunk) controller.error(error);
            else {
              var blockedChunk = previousBlockedChunk;
              previousBlockedChunk = null;
              blockedChunk.then(function () {
                return controller.error(error);
              });
            }
          }
        },
        streamState
      );
    }
    function asyncIterator() {
      return this;
    }
    function createIterator(next) {
      next = { next: next };
      next[ASYNC_ITERATOR] = asyncIterator;
      return next;
    }
    function startAsyncIterable(response, id, iterator, streamState) {
      var buffer = [],
        closed = !1,
        nextWriteIndex = 0,
        iterable = {};
      iterable[ASYNC_ITERATOR] = function () {
        var nextReadIndex = 0;
        return createIterator(function (arg) {
          if (void 0 !== arg)
            throw Error(
              "Values cannot be passed to next() of AsyncIterables passed to Client Components."
            );
          if (nextReadIndex === buffer.length) {
            if (closed)
              return new ReactPromise(
                "fulfilled",
                { done: !0, value: void 0 },
                null
              );
            buffer[nextReadIndex] = createPendingChunk(response);
          }
          return buffer[nextReadIndex++];
        });
      };
      resolveStream(
        response,
        id,
        iterator ? iterable[ASYNC_ITERATOR]() : iterable,
        {
          enqueueValue: function (value) {
            if (nextWriteIndex === buffer.length)
              buffer[nextWriteIndex] = new ReactPromise(
                "fulfilled",
                { done: !1, value: value },
                null
              );
            else {
              var chunk = buffer[nextWriteIndex],
                resolveListeners = chunk.value,
                rejectListeners = chunk.reason;
              chunk.status = "fulfilled";
              chunk.value = { done: !1, value: value };
              null !== resolveListeners &&
                wakeChunkIfInitialized(
                  chunk,
                  resolveListeners,
                  rejectListeners
                );
            }
            nextWriteIndex++;
          },
          enqueueModel: function (value) {
            nextWriteIndex === buffer.length
              ? (buffer[nextWriteIndex] = createResolvedIteratorResultChunk(
                  response,
                  value,
                  !1
                ))
              : resolveIteratorResultChunk(
                  response,
                  buffer[nextWriteIndex],
                  value,
                  !1
                );
            nextWriteIndex++;
          },
          close: function (value) {
            closed = !0;
            nextWriteIndex === buffer.length
              ? (buffer[nextWriteIndex] = createResolvedIteratorResultChunk(
                  response,
                  value,
                  !0
                ))
              : resolveIteratorResultChunk(
                  response,
                  buffer[nextWriteIndex],
                  value,
                  !0
                );
            for (nextWriteIndex++; nextWriteIndex < buffer.length; )
              resolveIteratorResultChunk(
                response,
                buffer[nextWriteIndex++],
                '"$undefined"',
                !0
              );
          },
          error: function (error) {
            closed = !0;
            for (
              nextWriteIndex === buffer.length &&
              (buffer[nextWriteIndex] = createPendingChunk(response));
              nextWriteIndex < buffer.length;

            )
              triggerErrorOnChunk(response, buffer[nextWriteIndex++], error);
          }
        },
        streamState
      );
    }
    function resolveErrorDev(response, errorInfo) {
      var name = errorInfo.name,
        env = errorInfo.env;
      var error = buildFakeCallStack(
        response,
        errorInfo.stack,
        env,
        !1,
        Error.bind(
          null,
          errorInfo.message ||
            "An error occurred in the Server Components render but no message was provided"
        )
      );
      var ownerTask = null;
      null != errorInfo.owner &&
        ((errorInfo = errorInfo.owner.slice(1)),
        (errorInfo = getOutlinedModel(
          response,
          errorInfo,
          {},
          "",
          createModel
        )),
        null !== errorInfo &&
          (ownerTask = initializeFakeTask(response, errorInfo)));
      null === ownerTask
        ? ((response = getRootTask(response, env)),
          (error = null != response ? response.run(error) : error()))
        : (error = ownerTask.run(error));
      error.name = name;
      error.environmentName = env;
      return error;
    }
    function createFakeFunction(
      name,
      filename,
      sourceMap,
      line,
      col,
      enclosingLine,
      enclosingCol,
      environmentName
    ) {
      name || (name = "<anonymous>");
      var encodedName = JSON.stringify(name);
      1 > enclosingLine ? (enclosingLine = 0) : enclosingLine--;
      1 > enclosingCol ? (enclosingCol = 0) : enclosingCol--;
      1 > line ? (line = 0) : line--;
      1 > col ? (col = 0) : col--;
      if (
        line < enclosingLine ||
        (line === enclosingLine && col < enclosingCol)
      )
        enclosingCol = enclosingLine = 0;
      1 > line
        ? ((line = encodedName.length + 3),
          (enclosingCol -= line),
          0 > enclosingCol && (enclosingCol = 0),
          (col = col - enclosingCol - line - 3),
          0 > col && (col = 0),
          (encodedName =
            "({" +
            encodedName +
            ":" +
            " ".repeat(enclosingCol) +
            "_=>" +
            " ".repeat(col) +
            "_()})"))
        : 1 > enclosingLine
          ? ((enclosingCol -= encodedName.length + 3),
            0 > enclosingCol && (enclosingCol = 0),
            (encodedName =
              "({" +
              encodedName +
              ":" +
              " ".repeat(enclosingCol) +
              "_=>" +
              "\n".repeat(line - enclosingLine) +
              " ".repeat(col) +
              "_()})"))
          : enclosingLine === line
            ? ((col = col - enclosingCol - 3),
              0 > col && (col = 0),
              (encodedName =
                "\n".repeat(enclosingLine - 1) +
                "({" +
                encodedName +
                ":\n" +
                " ".repeat(enclosingCol) +
                "_=>" +
                " ".repeat(col) +
                "_()})"))
            : (encodedName =
                "\n".repeat(enclosingLine - 1) +
                "({" +
                encodedName +
                ":\n" +
                " ".repeat(enclosingCol) +
                "_=>" +
                "\n".repeat(line - enclosingLine) +
                " ".repeat(col) +
                "_()})");
      encodedName =
        1 > enclosingLine
          ? encodedName +
            "\n/* This module was rendered by a Server Component. Turn on Source Maps to see the server source. */"
          : "/* This module was rendered by a Server Component. Turn on Source Maps to see the server source. */" +
            encodedName;
      filename.startsWith("/") && (filename = "file://" + filename);
      sourceMap
        ? ((encodedName +=
            "\n//# sourceURL=about://React/" +
            encodeURIComponent(environmentName) +
            "/" +
            encodeURI(filename) +
            "?" +
            fakeFunctionIdx++),
          (encodedName += "\n//# sourceMappingURL=" + sourceMap))
        : (encodedName = filename
            ? encodedName + ("\n//# sourceURL=" + encodeURI(filename))
            : encodedName + "\n//# sourceURL=<anonymous>");
      try {
        var fn = (0, eval)(encodedName)[name];
      } catch (x) {
        fn = function (_) {
          return _();
        };
      }
      return fn;
    }
    function buildFakeCallStack(
      response,
      stack,
      environmentName,
      useEnclosingLine,
      innerCall
    ) {
      for (var i = 0; i < stack.length; i++) {
        var frame = stack[i],
          frameKey =
            frame.join("-") +
            "-" +
            environmentName +
            (useEnclosingLine ? "-e" : "-n"),
          fn = fakeFunctionCache.get(frameKey);
        if (void 0 === fn) {
          fn = frame[0];
          var filename = frame[1],
            line = frame[2],
            col = frame[3],
            enclosingLine = frame[4];
          frame = frame[5];
          var findSourceMapURL = response._debugFindSourceMapURL;
          findSourceMapURL = findSourceMapURL
            ? findSourceMapURL(filename, environmentName)
            : null;
          fn = createFakeFunction(
            fn,
            filename,
            findSourceMapURL,
            line,
            col,
            useEnclosingLine ? line : enclosingLine,
            useEnclosingLine ? col : frame,
            environmentName
          );
          fakeFunctionCache.set(frameKey, fn);
        }
        innerCall = fn.bind(null, innerCall);
      }
      return innerCall;
    }
    function getRootTask(response, childEnvironmentName) {
      var rootTask = response._debugRootTask;
      return rootTask
        ? response._rootEnvironmentName !== childEnvironmentName
          ? ((response = console.createTask.bind(
              console,
              '"use ' + childEnvironmentName.toLowerCase() + '"'
            )),
            rootTask.run(response))
          : rootTask
        : null;
    }
    function initializeFakeTask(response, debugInfo) {
      if (!supportsCreateTask || null == debugInfo.stack) return null;
      var cachedEntry = debugInfo.debugTask;
      if (void 0 !== cachedEntry) return cachedEntry;
      var useEnclosingLine = void 0 === debugInfo.key,
        stack = debugInfo.stack,
        env =
          null == debugInfo.env ? response._rootEnvironmentName : debugInfo.env;
      cachedEntry =
        null == debugInfo.owner || null == debugInfo.owner.env
          ? response._rootEnvironmentName
          : debugInfo.owner.env;
      var ownerTask =
        null == debugInfo.owner
          ? null
          : initializeFakeTask(response, debugInfo.owner);
      env =
        env !== cachedEntry
          ? '"use ' + env.toLowerCase() + '"'
          : void 0 !== debugInfo.key
            ? "<" + (debugInfo.name || "...") + ">"
            : void 0 !== debugInfo.name
              ? debugInfo.name || "unknown"
              : "await " + (debugInfo.awaited.name || "unknown");
      env = console.createTask.bind(console, env);
      useEnclosingLine = buildFakeCallStack(
        response,
        stack,
        cachedEntry,
        useEnclosingLine,
        env
      );
      null === ownerTask
        ? ((response = getRootTask(response, cachedEntry)),
          (response =
            null != response
              ? response.run(useEnclosingLine)
              : useEnclosingLine()))
        : (response = ownerTask.run(useEnclosingLine));
      return (debugInfo.debugTask = response);
    }
    function fakeJSXCallSite() {
      return Error("react-stack-top-frame");
    }
    function initializeFakeStack(response, debugInfo) {
      if (void 0 === debugInfo.debugStack) {
        null != debugInfo.stack &&
          (debugInfo.debugStack = createFakeJSXCallStackInDEV(
            response,
            debugInfo.stack,
            null == debugInfo.env ? "" : debugInfo.env
          ));
        var owner = debugInfo.owner;
        null != owner &&
          (initializeFakeStack(response, owner),
          void 0 === owner.debugLocation &&
            null != debugInfo.debugStack &&
            (owner.debugLocation = debugInfo.debugStack));
      }
    }
    function initializeDebugInfo(response, debugInfo) {
      void 0 !== debugInfo.stack && initializeFakeTask(response, debugInfo);
      null == debugInfo.owner && null != response._debugRootOwner
        ? ((debugInfo.owner = response._debugRootOwner),
          (debugInfo.stack = null),
          (debugInfo.debugStack = response._debugRootStack),
          (debugInfo.debugTask = response._debugRootTask))
        : void 0 !== debugInfo.stack &&
          initializeFakeStack(response, debugInfo);
      return debugInfo;
    }
    function getCurrentStackInDEV() {
      var owner = currentOwnerInDEV;
      if (null === owner) return "";
      try {
        var info = "";
        if (owner.owner || "string" !== typeof owner.name) {
          for (; owner; ) {
            var ownerStack = owner.debugStack;
            if (null != ownerStack) {
              if ((owner = owner.owner)) {
                var JSCompiler_temp_const = info;
                var error = ownerStack,
                  prevPrepareStackTrace = Error.prepareStackTrace;
                Error.prepareStackTrace = void 0;
                var stack = error.stack;
                Error.prepareStackTrace = prevPrepareStackTrace;
                stack.startsWith("Error: react-stack-top-frame\n") &&
                  (stack = stack.slice(29));
                var idx = stack.indexOf("\n");
                -1 !== idx && (stack = stack.slice(idx + 1));
                idx = stack.indexOf("react_stack_bottom_frame");
                -1 !== idx && (idx = stack.lastIndexOf("\n", idx));
                var JSCompiler_inline_result =
                  -1 !== idx ? (stack = stack.slice(0, idx)) : "";
                info =
                  JSCompiler_temp_const + ("\n" + JSCompiler_inline_result);
              }
            } else break;
          }
          var JSCompiler_inline_result$jscomp$0 = info;
        } else {
          JSCompiler_temp_const = owner.name;
          if (void 0 === prefix)
            try {
              throw Error();
            } catch (x) {
              (prefix =
                ((error = x.stack.trim().match(/\n( *(at )?)/)) && error[1]) ||
                ""),
                (suffix =
                  -1 < x.stack.indexOf("\n    at")
                    ? " (<anonymous>)"
                    : -1 < x.stack.indexOf("@")
                      ? "@unknown:0:0"
                      : "");
            }
          JSCompiler_inline_result$jscomp$0 =
            "\n" + prefix + JSCompiler_temp_const + suffix;
        }
      } catch (x) {
        JSCompiler_inline_result$jscomp$0 =
          "\nError generating stack: " + x.message + "\n" + x.stack;
      }
      return JSCompiler_inline_result$jscomp$0;
    }
    function resolveConsoleEntry(response, json) {
      if (response._replayConsole) {
        var blockedChunk = response._blockedConsole;
        if (null == blockedChunk)
          (blockedChunk = createResolvedModelChunk(response, json)),
            initializeModelChunk(blockedChunk),
            "fulfilled" === blockedChunk.status
              ? replayConsoleWithCallStackInDEV(response, blockedChunk.value)
              : (blockedChunk.then(
                  function (v) {
                    return replayConsoleWithCallStackInDEV(response, v);
                  },
                  function () {}
                ),
                (response._blockedConsole = blockedChunk));
        else {
          var _chunk4 = createPendingChunk(response);
          _chunk4.then(
            function (v) {
              return replayConsoleWithCallStackInDEV(response, v);
            },
            function () {}
          );
          response._blockedConsole = _chunk4;
          var unblock = function () {
            response._blockedConsole === _chunk4 &&
              (response._blockedConsole = null);
            resolveModelChunk(response, _chunk4, json);
          };
          blockedChunk.then(unblock, unblock);
        }
      }
    }
    function initializeIOInfo(response, ioInfo) {
      void 0 !== ioInfo.stack &&
        (initializeFakeTask(response, ioInfo),
        initializeFakeStack(response, ioInfo));
      ioInfo.start += response._timeOrigin;
      ioInfo.end += response._timeOrigin;
    }
    function resolveIOInfo(response, id, model) {
      var chunks = response._chunks,
        chunk = chunks.get(id);
      chunk
        ? (resolveModelChunk(response, chunk, model),
          "resolved_model" === chunk.status && initializeModelChunk(chunk))
        : ((chunk = createResolvedModelChunk(response, model)),
          chunks.set(id, chunk),
          initializeModelChunk(chunk));
      "fulfilled" === chunk.status
        ? initializeIOInfo(response, chunk.value)
        : chunk.then(
            function (v) {
              initializeIOInfo(response, v);
            },
            function () {}
          );
    }
    function mergeBuffer(buffer, lastChunk) {
      for (
        var l = buffer.length, byteLength = lastChunk.length, i = 0;
        i < l;
        i++
      )
        byteLength += buffer[i].byteLength;
      byteLength = new Uint8Array(byteLength);
      for (var _i3 = (i = 0); _i3 < l; _i3++) {
        var chunk = buffer[_i3];
        byteLength.set(chunk, i);
        i += chunk.byteLength;
      }
      byteLength.set(lastChunk, i);
      return byteLength;
    }
    function resolveTypedArray(
      response,
      id,
      buffer,
      lastChunk,
      constructor,
      bytesPerElement,
      streamState
    ) {
      buffer =
        0 === buffer.length && 0 === lastChunk.byteOffset % bytesPerElement
          ? lastChunk
          : mergeBuffer(buffer, lastChunk);
      constructor = new constructor(
        buffer.buffer,
        buffer.byteOffset,
        buffer.byteLength / bytesPerElement
      );
      resolveBuffer(response, id, constructor, streamState);
    }
    function flushInitialRenderPerformance() {}
    function processFullBinaryRow(
      response,
      streamState,
      id,
      tag,
      buffer,
      chunk
    ) {
      switch (tag) {
        case 65:
          resolveBuffer(
            response,
            id,
            mergeBuffer(buffer, chunk).buffer,
            streamState
          );
          return;
        case 79:
          resolveTypedArray(
            response,
            id,
            buffer,
            chunk,
            Int8Array,
            1,
            streamState
          );
          return;
        case 111:
          resolveBuffer(
            response,
            id,
            0 === buffer.length ? chunk : mergeBuffer(buffer, chunk),
            streamState
          );
          return;
        case 85:
          resolveTypedArray(
            response,
            id,
            buffer,
            chunk,
            Uint8ClampedArray,
            1,
            streamState
          );
          return;
        case 83:
          resolveTypedArray(
            response,
            id,
            buffer,
            chunk,
            Int16Array,
            2,
            streamState
          );
          return;
        case 115:
          resolveTypedArray(
            response,
            id,
            buffer,
            chunk,
            Uint16Array,
            2,
            streamState
          );
          return;
        case 76:
          resolveTypedArray(
            response,
            id,
            buffer,
            chunk,
            Int32Array,
            4,
            streamState
          );
          return;
        case 108:
          resolveTypedArray(
            response,
            id,
            buffer,
            chunk,
            Uint32Array,
            4,
            streamState
          );
          return;
        case 71:
          resolveTypedArray(
            response,
            id,
            buffer,
            chunk,
            Float32Array,
            4,
            streamState
          );
          return;
        case 103:
          resolveTypedArray(
            response,
            id,
            buffer,
            chunk,
            Float64Array,
            8,
            streamState
          );
          return;
        case 77:
          resolveTypedArray(
            response,
            id,
            buffer,
            chunk,
            BigInt64Array,
            8,
            streamState
          );
          return;
        case 109:
          resolveTypedArray(
            response,
            id,
            buffer,
            chunk,
            BigUint64Array,
            8,
            streamState
          );
          return;
        case 86:
          resolveTypedArray(
            response,
            id,
            buffer,
            chunk,
            DataView,
            1,
            streamState
          );
          return;
      }
      for (
        var stringDecoder = response._stringDecoder, row = "", i = 0;
        i < buffer.length;
        i++
      )
        row += stringDecoder.decode(buffer[i], decoderOptions);
      row += stringDecoder.decode(chunk);
      processFullStringRow(response, streamState, id, tag, row);
    }
    function processFullStringRow(response, streamState, id, tag, row) {
      switch (tag) {
        case 73:
          resolveModule(response, id, row, streamState);
          break;
        case 72:
          id = row[0];
          streamState = row.slice(1);
          response = JSON.parse(streamState, response._fromJSON);
          streamState = ReactDOMSharedInternals.d;
          switch (id) {
            case "D":
              streamState.D(response);
              break;
            case "C":
              "string" === typeof response
                ? streamState.C(response)
                : streamState.C(response[0], response[1]);
              break;
            case "L":
              id = response[0];
              row = response[1];
              3 === response.length
                ? streamState.L(id, row, response[2])
                : streamState.L(id, row);
              break;
            case "m":
              "string" === typeof response
                ? streamState.m(response)
                : streamState.m(response[0], response[1]);
              break;
            case "X":
              "string" === typeof response
                ? streamState.X(response)
                : streamState.X(response[0], response[1]);
              break;
            case "S":
              "string" === typeof response
                ? streamState.S(response)
                : streamState.S(
                    response[0],
                    0 === response[1] ? void 0 : response[1],
                    3 === response.length ? response[2] : void 0
                  );
              break;
            case "M":
              "string" === typeof response
                ? streamState.M(response)
                : streamState.M(response[0], response[1]);
          }
          break;
        case 69:
          tag = response._chunks;
          var chunk = tag.get(id);
          row = JSON.parse(row);
          var error = resolveErrorDev(response, row);
          error.digest = row.digest;
          chunk
            ? (resolveChunkDebugInfo(streamState, chunk),
              triggerErrorOnChunk(response, chunk, error))
            : ((response = new ReactPromise("rejected", null, error)),
              resolveChunkDebugInfo(streamState, response),
              tag.set(id, response));
          break;
        case 84:
          tag = response._chunks;
          (chunk = tag.get(id)) && "pending" !== chunk.status
            ? chunk.reason.enqueueValue(row)
            : (chunk && releasePendingChunk(response, chunk),
              (response = new ReactPromise("fulfilled", row, null)),
              resolveChunkDebugInfo(streamState, response),
              tag.set(id, response));
          break;
        case 78:
          response._timeOrigin = +row - performance.timeOrigin;
          break;
        case 68:
          id = getChunk(response, id);
          "fulfilled" !== id.status &&
            "rejected" !== id.status &&
            "halted" !== id.status &&
            "blocked" !== id.status &&
            "resolved_module" !== id.status &&
            ((streamState = id._debugChunk),
            (tag = createResolvedModelChunk(response, row)),
            (tag._debugChunk = streamState),
            (id._debugChunk = tag),
            initializeDebugChunk(response, id),
            "blocked" !== tag.status ||
              (void 0 !== response._debugChannel &&
                response._debugChannel.hasReadable) ||
              '"' !== row[0] ||
              "$" !== row[1] ||
              ((streamState = row.slice(2, row.length - 1).split(":")),
              (streamState = parseInt(streamState[0], 16)),
              "pending" === getChunk(response, streamState).status &&
                (id._debugChunk = null)));
          break;
        case 74:
          resolveIOInfo(response, id, row);
          break;
        case 87:
          resolveConsoleEntry(response, row);
          break;
        case 82:
          startReadableStream(response, id, void 0, streamState);
          break;
        case 114:
          startReadableStream(response, id, "bytes", streamState);
          break;
        case 88:
          startAsyncIterable(response, id, !1, streamState);
          break;
        case 120:
          startAsyncIterable(response, id, !0, streamState);
          break;
        case 67:
          (response = response._chunks.get(id)) &&
            "fulfilled" === response.status &&
            response.reason.close("" === row ? '"$undefined"' : row);
          break;
        default:
          if ("" === row) {
            if (
              ((streamState = response._chunks),
              (row = streamState.get(id)) ||
                streamState.set(id, (row = createPendingChunk(response))),
              "pending" === row.status || "blocked" === row.status)
            )
              releasePendingChunk(response, row),
                (response = row),
                (response.status = "halted"),
                (response.value = null),
                (response.reason = null);
          } else
            (tag = response._chunks),
              (chunk = tag.get(id))
                ? (resolveChunkDebugInfo(streamState, chunk),
                  resolveModelChunk(response, chunk, row))
                : ((response = createResolvedModelChunk(response, row)),
                  resolveChunkDebugInfo(streamState, response),
                  tag.set(id, response));
      }
    }
    function createFromJSONCallback(response) {
      return function (key, value) {
        if ("string" === typeof value)
          return parseModelString(response, this, key, value);
        if ("object" === typeof value && null !== value) {
          if (value[0] === REACT_ELEMENT_TYPE)
            b: {
              var owner = value[4],
                stack = value[5];
              key = value[6];
              value = {
                $$typeof: REACT_ELEMENT_TYPE,
                type: value[1],
                key: value[2],
                props: value[3],
                _owner: void 0 === owner ? null : owner
              };
              Object.defineProperty(value, "ref", {
                enumerable: !1,
                get: nullRefGetter
              });
              value._store = {};
              Object.defineProperty(value._store, "validated", {
                configurable: !1,
                enumerable: !1,
                writable: !0,
                value: key
              });
              Object.defineProperty(value, "_debugInfo", {
                configurable: !1,
                enumerable: !1,
                writable: !0,
                value: null
              });
              Object.defineProperty(value, "_debugStack", {
                configurable: !1,
                enumerable: !1,
                writable: !0,
                value: void 0 === stack ? null : stack
              });
              Object.defineProperty(value, "_debugTask", {
                configurable: !1,
                enumerable: !1,
                writable: !0,
                value: null
              });
              if (null !== initializingHandler) {
                owner = initializingHandler;
                initializingHandler = owner.parent;
                if (owner.errored) {
                  stack = new ReactPromise("rejected", null, owner.reason);
                  initializeElement(response, value, null);
                  owner = {
                    name: getComponentNameFromType(value.type) || "",
                    owner: value._owner
                  };
                  owner.debugStack = value._debugStack;
                  supportsCreateTask && (owner.debugTask = value._debugTask);
                  stack._debugInfo = [owner];
                  key = createLazyChunkWrapper(stack, key);
                  break b;
                }
                if (0 < owner.deps) {
                  stack = new ReactPromise("blocked", null, null);
                  owner.value = value;
                  owner.chunk = stack;
                  key = createLazyChunkWrapper(stack, key);
                  value = initializeElement.bind(null, response, value, key);
                  stack.then(value, value);
                  break b;
                }
              }
              initializeElement(response, value, null);
              key = value;
            }
          else key = value;
          return key;
        }
        return value;
      };
    }
    function close(weakResponse) {
      reportGlobalError(weakResponse, Error("Connection closed."));
    }
    function noServerCall() {
      throw Error(
        "Server Functions cannot be called during initial render. This would create a fetch waterfall. Try to use a Server Component to pass data to Client Components instead."
      );
    }
    function startReadingFromStream(response$jscomp$0, stream, onEnd) {
      var streamState = createStreamState(response$jscomp$0, stream);
      stream.on("data", function (chunk) {
        if ("string" === typeof chunk) {
          if (void 0 !== response$jscomp$0.weak.deref()) {
            var response = unwrapWeakResponse(response$jscomp$0),
              i = 0,
              rowState = streamState._rowState,
              rowID = streamState._rowID,
              rowTag = streamState._rowTag,
              rowLength = streamState._rowLength,
              buffer = streamState._buffer,
              chunkLength = chunk.length;
            for (
              incrementChunkDebugInfo(streamState, chunkLength);
              i < chunkLength;

            ) {
              var lastIdx = -1;
              switch (rowState) {
                case 0:
                  lastIdx = chunk.charCodeAt(i++);
                  58 === lastIdx
                    ? (rowState = 1)
                    : (rowID =
                        (rowID << 4) |
                        (96 < lastIdx ? lastIdx - 87 : lastIdx - 48));
                  continue;
                case 1:
                  rowState = chunk.charCodeAt(i);
                  84 === rowState ||
                  65 === rowState ||
                  79 === rowState ||
                  111 === rowState ||
                  85 === rowState ||
                  83 === rowState ||
                  115 === rowState ||
                  76 === rowState ||
                  108 === rowState ||
                  71 === rowState ||
                  103 === rowState ||
                  77 === rowState ||
                  109 === rowState ||
                  86 === rowState
                    ? ((rowTag = rowState), (rowState = 2), i++)
                    : (64 < rowState && 91 > rowState) ||
                        114 === rowState ||
                        120 === rowState
                      ? ((rowTag = rowState), (rowState = 3), i++)
                      : ((rowTag = 0), (rowState = 3));
                  continue;
                case 2:
                  lastIdx = chunk.charCodeAt(i++);
                  44 === lastIdx
                    ? (rowState = 4)
                    : (rowLength =
                        (rowLength << 4) |
                        (96 < lastIdx ? lastIdx - 87 : lastIdx - 48));
                  continue;
                case 3:
                  lastIdx = chunk.indexOf("\n", i);
                  break;
                case 4:
                  if (84 !== rowTag)
                    throw Error(
                      "Binary RSC chunks cannot be encoded as strings. This is a bug in the wiring of the React streams."
                    );
                  if (rowLength < chunk.length || chunk.length > 3 * rowLength)
                    throw Error(
                      "String chunks need to be passed in their original shape. Not split into smaller string chunks. This is a bug in the wiring of the React streams."
                    );
                  lastIdx = chunk.length;
              }
              if (-1 < lastIdx) {
                if (0 < buffer.length)
                  throw Error(
                    "String chunks need to be passed in their original shape. Not split into smaller string chunks. This is a bug in the wiring of the React streams."
                  );
                i = chunk.slice(i, lastIdx);
                processFullStringRow(response, streamState, rowID, rowTag, i);
                i = lastIdx;
                3 === rowState && i++;
                rowLength = rowID = rowTag = rowState = 0;
                buffer.length = 0;
              } else if (chunk.length !== i)
                throw Error(
                  "String chunks need to be passed in their original shape. Not split into smaller string chunks. This is a bug in the wiring of the React streams."
                );
            }
            streamState._rowState = rowState;
            streamState._rowID = rowID;
            streamState._rowTag = rowTag;
            streamState._rowLength = rowLength;
          }
        } else if (void 0 !== response$jscomp$0.weak.deref()) {
          buffer = unwrapWeakResponse(response$jscomp$0);
          rowLength = 0;
          chunkLength = streamState._rowState;
          response = streamState._rowID;
          i = streamState._rowTag;
          rowState = streamState._rowLength;
          rowID = streamState._buffer;
          rowTag = chunk.length;
          for (
            incrementChunkDebugInfo(streamState, rowTag);
            rowLength < rowTag;

          ) {
            lastIdx = -1;
            switch (chunkLength) {
              case 0:
                lastIdx = chunk[rowLength++];
                58 === lastIdx
                  ? (chunkLength = 1)
                  : (response =
                      (response << 4) |
                      (96 < lastIdx ? lastIdx - 87 : lastIdx - 48));
                continue;
              case 1:
                chunkLength = chunk[rowLength];
                84 === chunkLength ||
                65 === chunkLength ||
                79 === chunkLength ||
                111 === chunkLength ||
                85 === chunkLength ||
                83 === chunkLength ||
                115 === chunkLength ||
                76 === chunkLength ||
                108 === chunkLength ||
                71 === chunkLength ||
                103 === chunkLength ||
                77 === chunkLength ||
                109 === chunkLength ||
                86 === chunkLength
                  ? ((i = chunkLength), (chunkLength = 2), rowLength++)
                  : (64 < chunkLength && 91 > chunkLength) ||
                      35 === chunkLength ||
                      114 === chunkLength ||
                      120 === chunkLength
                    ? ((i = chunkLength), (chunkLength = 3), rowLength++)
                    : ((i = 0), (chunkLength = 3));
                continue;
              case 2:
                lastIdx = chunk[rowLength++];
                44 === lastIdx
                  ? (chunkLength = 4)
                  : (rowState =
                      (rowState << 4) |
                      (96 < lastIdx ? lastIdx - 87 : lastIdx - 48));
                continue;
              case 3:
                lastIdx = chunk.indexOf(10, rowLength);
                break;
              case 4:
                (lastIdx = rowLength + rowState),
                  lastIdx > chunk.length && (lastIdx = -1);
            }
            var offset = chunk.byteOffset + rowLength;
            if (-1 < lastIdx)
              (rowState = new Uint8Array(
                chunk.buffer,
                offset,
                lastIdx - rowLength
              )),
                processFullBinaryRow(
                  buffer,
                  streamState,
                  response,
                  i,
                  rowID,
                  rowState
                ),
                (rowLength = lastIdx),
                3 === chunkLength && rowLength++,
                (rowState = response = i = chunkLength = 0),
                (rowID.length = 0);
            else {
              chunk = new Uint8Array(
                chunk.buffer,
                offset,
                chunk.byteLength - rowLength
              );
              rowID.push(chunk);
              rowState -= chunk.byteLength;
              break;
            }
          }
          streamState._rowState = chunkLength;
          streamState._rowID = response;
          streamState._rowTag = i;
          streamState._rowLength = rowState;
        }
      });
      stream.on("error", function (error) {
        reportGlobalError(response$jscomp$0, error);
      });
      stream.on("end", onEnd);
    }
    var ReactDOM = require("react-dom"),
      React = require("react"),
      decoderOptions = { stream: !0 },
      bind$1 = Function.prototype.bind,
      asyncModuleCache = new Map(),
      ReactDOMSharedInternals =
        ReactDOM.__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE,
      REACT_ELEMENT_TYPE = Symbol.for("react.transitional.element"),
      REACT_PORTAL_TYPE = Symbol.for("react.portal"),
      REACT_FRAGMENT_TYPE = Symbol.for("react.fragment"),
      REACT_STRICT_MODE_TYPE = Symbol.for("react.strict_mode"),
      REACT_PROFILER_TYPE = Symbol.for("react.profiler"),
      REACT_CONSUMER_TYPE = Symbol.for("react.consumer"),
      REACT_CONTEXT_TYPE = Symbol.for("react.context"),
      REACT_FORWARD_REF_TYPE = Symbol.for("react.forward_ref"),
      REACT_SUSPENSE_TYPE = Symbol.for("react.suspense"),
      REACT_SUSPENSE_LIST_TYPE = Symbol.for("react.suspense_list"),
      REACT_MEMO_TYPE = Symbol.for("react.memo"),
      REACT_LAZY_TYPE = Symbol.for("react.lazy"),
      REACT_ACTIVITY_TYPE = Symbol.for("react.activity"),
      MAYBE_ITERATOR_SYMBOL = Symbol.iterator,
      ASYNC_ITERATOR = Symbol.asyncIterator,
      isArrayImpl = Array.isArray,
      getPrototypeOf = Object.getPrototypeOf,
      jsxPropsParents = new WeakMap(),
      jsxChildrenParents = new WeakMap(),
      CLIENT_REFERENCE_TAG = Symbol.for("react.client.reference"),
      ObjectPrototype = Object.prototype,
      knownServerReferences = new WeakMap(),
      boundCache = new WeakMap(),
      fakeServerFunctionIdx = 0,
      FunctionBind = Function.prototype.bind,
      ArraySlice = Array.prototype.slice,
      v8FrameRegExp =
        /^ {3} at (?:(.+) \((.+):(\d+):(\d+)\)|(?:async )?(.+):(\d+):(\d+))$/,
      jscSpiderMonkeyFrameRegExp = /(?:(.*)@)?(.*):(\d+):(\d+)/,
      REACT_CLIENT_REFERENCE = Symbol.for("react.client.reference"),
      prefix,
      suffix;
    new ("function" === typeof WeakMap ? WeakMap : Map)();
    var ReactSharedInteralsServer =
        React.__SERVER_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE,
      ReactSharedInternals =
        React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE ||
        ReactSharedInteralsServer;
    ReactPromise.prototype = Object.create(Promise.prototype);
    ReactPromise.prototype.then = function (resolve, reject) {
      var _this = this;
      switch (this.status) {
        case "resolved_model":
          initializeModelChunk(this);
          break;
        case "resolved_module":
          initializeModuleChunk(this);
      }
      var resolveCallback = resolve,
        rejectCallback = reject,
        wrapperPromise = new Promise(function (res, rej) {
          resolve = function (value) {
            wrapperPromise._debugInfo = _this._debugInfo;
            res(value);
          };
          reject = function (reason) {
            wrapperPromise._debugInfo = _this._debugInfo;
            rej(reason);
          };
        });
      wrapperPromise.then(resolveCallback, rejectCallback);
      switch (this.status) {
        case "fulfilled":
          "function" === typeof resolve && resolve(this.value);
          break;
        case "pending":
        case "blocked":
          "function" === typeof resolve &&
            (null === this.value && (this.value = []),
            this.value.push(resolve));
          "function" === typeof reject &&
            (null === this.reason && (this.reason = []),
            this.reason.push(reject));
          break;
        case "halted":
          break;
        default:
          "function" === typeof reject && reject(this.reason);
      }
    };
    var debugChannelRegistry =
        "function" === typeof FinalizationRegistry
          ? new FinalizationRegistry(closeDebugChannel)
          : null,
      initializingHandler = null,
      initializingChunk = null,
      mightHaveStaticConstructor = /\bclass\b.*\bstatic\b/,
      MIN_CHUNK_SIZE = 65536,
      supportsCreateTask = !!console.createTask,
      fakeFunctionCache = new Map(),
      fakeFunctionIdx = 0,
      createFakeJSXCallStack = {
        react_stack_bottom_frame: function (response, stack, environmentName) {
          return buildFakeCallStack(
            response,
            stack,
            environmentName,
            !1,
            fakeJSXCallSite
          )();
        }
      },
      createFakeJSXCallStackInDEV =
        createFakeJSXCallStack.react_stack_bottom_frame.bind(
          createFakeJSXCallStack
        ),
      currentOwnerInDEV = null,
      replayConsoleWithCallStack = {
        react_stack_bottom_frame: function (response, payload) {
          var methodName = payload[0],
            stackTrace = payload[1],
            owner = payload[2],
            env = payload[3];
          payload = payload.slice(4);
          var prevStack = ReactSharedInternals.getCurrentStack;
          ReactSharedInternals.getCurrentStack = getCurrentStackInDEV;
          currentOwnerInDEV = null === owner ? response._debugRootOwner : owner;
          try {
            a: {
              var offset = 0;
              switch (methodName) {
                case "dir":
                case "dirxml":
                case "groupEnd":
                case "table":
                  var JSCompiler_inline_result = bind$1.apply(
                    console[methodName],
                    [console].concat(payload)
                  );
                  break a;
                case "assert":
                  offset = 1;
              }
              var newArgs = payload.slice(0);
              "string" === typeof newArgs[offset]
                ? newArgs.splice(
                    offset,
                    1,
                    "[%s] " + newArgs[offset],
                    " " + env + " "
                  )
                : newArgs.splice(offset, 0, "[%s]", " " + env + " ");
              newArgs.unshift(console);
              JSCompiler_inline_result = bind$1.apply(
                console[methodName],
                newArgs
              );
            }
            var callStack = buildFakeCallStack(
              response,
              stackTrace,
              env,
              !1,
              JSCompiler_inline_result
            );
            if (null != owner) {
              var task = initializeFakeTask(response, owner);
              initializeFakeStack(response, owner);
              if (null !== task) {
                task.run(callStack);
                return;
              }
            }
            var rootTask = getRootTask(response, env);
            null != rootTask ? rootTask.run(callStack) : callStack();
          } finally {
            (currentOwnerInDEV = null),
              (ReactSharedInternals.getCurrentStack = prevStack);
          }
        }
      },
      replayConsoleWithCallStackInDEV =
        replayConsoleWithCallStack.react_stack_bottom_frame.bind(
          replayConsoleWithCallStack
        );
    exports.createFromNodeStream = function (
      stream,
      serverConsumerManifest,
      options
    ) {
      var response = new ResponseInstance(
        serverConsumerManifest.moduleMap,
        serverConsumerManifest.serverModuleMap,
        serverConsumerManifest.moduleLoading,
        noServerCall,
        options ? options.encodeFormAction : void 0,
        options && "string" === typeof options.nonce ? options.nonce : void 0,
        void 0,
        options && options.findSourceMapURL ? options.findSourceMapURL : void 0,
        options ? !0 === options.replayConsoleLogs : !1,
        options && options.environmentName ? options.environmentName : void 0,
        options && void 0 !== options.debugChannel
          ? {
              hasReadable: void 0 !== options.debugChannel.readable,
              callback: null
            }
          : void 0
      )._weakResponse;
      if (options && options.debugChannel) {
        var streamEndedCount = 0;
        serverConsumerManifest = function () {
          2 === ++streamEndedCount && close(response);
        };
        startReadingFromStream(
          response,
          options.debugChannel,
          serverConsumerManifest
        );
        startReadingFromStream(response, stream, serverConsumerManifest);
      } else
        startReadingFromStream(response, stream, close.bind(null, response));
      return getRoot(response);
    };
    exports.createServerReference = function (
      id,
      callServer,
      encodeFormAction,
      findSourceMapURL,
      functionName
    ) {
      function action() {
        var args = Array.prototype.slice.call(arguments);
        return callServer(id, args);
      }
      var location = parseStackLocation(Error("react-stack-top-frame"));
      if (null !== location) {
        var filename = location[1],
          line = location[2];
        location = location[3];
        findSourceMapURL =
          null == findSourceMapURL
            ? null
            : findSourceMapURL(filename, "Client");
        action = createFakeServerFunction(
          functionName || "",
          filename,
          findSourceMapURL,
          line,
          location,
          "Client",
          action
        );
      }
      registerBoundServerReference(action, id, null, encodeFormAction);
      return action;
    };
    exports.createTemporaryReferenceSet = function () {
      return new Map();
    };
    exports.encodeReply = function (value, options) {
      return new Promise(function (resolve, reject) {
        var abort = processReply(
          value,
          "",
          options && options.temporaryReferences
            ? options.temporaryReferences
            : void 0,
          resolve,
          reject
        );
        if (options && options.signal) {
          var signal = options.signal;
          if (signal.aborted) abort(signal.reason);
          else {
            var listener = function () {
              abort(signal.reason);
              signal.removeEventListener("abort", listener);
            };
            signal.addEventListener("abort", listener);
          }
        }
      });
    };
    exports.registerServerReference = function (
      reference,
      id,
      encodeFormAction
    ) {
      registerBoundServerReference(reference, id, null, encodeFormAction);
      return reference;
    };
  })();
