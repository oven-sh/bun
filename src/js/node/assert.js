// @module "node:assert"
var { Bun } = import.meta.primordials;
var isDeepEqual = Bun.deepEquals;
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf,
  __hasOwnProp = Object.prototype.hasOwnProperty;
var __markAsModule = target => __defProp(target, "__esModule", { value: !0 });
var __commonJS = (cb, mod) =>
  function () {
    return mod || (0, cb[Object.keys(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  };
var __reExport = (target, module2, desc) => {
    if ((module2 && typeof module2 == "object") || typeof module2 == "function")
      for (let key of __getOwnPropNames(module2))
        !__hasOwnProp.call(target, key) &&
          key !== "default" &&
          __defProp(target, key, {
            get: () => module2[key],
            enumerable: !(desc = __getOwnPropDesc(module2, key)) || desc.enumerable,
          });
    return target;
  },
  __toModule = module2 =>
    __reExport(
      __markAsModule(
        __defProp(
          module2 != null ? __create(__getProtoOf(module2)) : {},
          "default",
          module2 && module2.__esModule && "default" in module2
            ? { get: () => module2.default, enumerable: !0 }
            : { value: module2, enumerable: !0 },
        ),
      ),
      module2,
    );

var require = path => import.meta.require(path);

// assert/build/internal/errors.js
var require_errors = __commonJS({
  "assert/build/internal/errors.js"(exports, module2) {
    "use strict";
    function _typeof(obj) {
      return (
        typeof Symbol == "function" && typeof Symbol.iterator == "symbol"
          ? (_typeof = function (obj2) {
              return typeof obj2;
            })
          : (_typeof = function (obj2) {
              return obj2 && typeof Symbol == "function" && obj2.constructor === Symbol && obj2 !== Symbol.prototype
                ? "symbol"
                : typeof obj2;
            }),
        _typeof(obj)
      );
    }
    function _classCallCheck(instance, Constructor) {
      if (!(instance instanceof Constructor)) throw new TypeError("Cannot call a class as a function");
    }
    function _possibleConstructorReturn(self, call) {
      return call && (_typeof(call) === "object" || typeof call == "function") ? call : _assertThisInitialized(self);
    }
    function _assertThisInitialized(self) {
      if (self === void 0) throw new ReferenceError("this hasn't been initialised - super() hasn't been called");
      return self;
    }
    function _getPrototypeOf(o) {
      return (
        (_getPrototypeOf = Object.setPrototypeOf
          ? Object.getPrototypeOf
          : function (o2) {
              return o2.__proto__ || Object.getPrototypeOf(o2);
            }),
        _getPrototypeOf(o)
      );
    }
    function _inherits(subClass, superClass) {
      if (typeof superClass != "function" && superClass !== null)
        throw new TypeError("Super expression must either be null or a function");
      (subClass.prototype = Object.create(superClass && superClass.prototype, {
        constructor: { value: subClass, writable: !0, configurable: !0 },
      })),
        superClass && _setPrototypeOf(subClass, superClass);
    }
    function _setPrototypeOf(o, p) {
      return (
        (_setPrototypeOf =
          Object.setPrototypeOf ||
          function (o2, p2) {
            return (o2.__proto__ = p2), o2;
          }),
        _setPrototypeOf(o, p)
      );
    }
    var codes = {},
      assert,
      util;
    function createErrorType(code, message, Base) {
      Base || (Base = Error);
      function getMessage(arg1, arg2, arg3) {
        return typeof message == "string" ? message : message(arg1, arg2, arg3);
      }
      var NodeError = /* @__PURE__ */ (function (_Base) {
        _inherits(NodeError2, _Base);
        function NodeError2(arg1, arg2, arg3) {
          var _this;
          return (
            _classCallCheck(this, NodeError2),
            (_this = _possibleConstructorReturn(
              this,
              _getPrototypeOf(NodeError2).call(this, getMessage(arg1, arg2, arg3)),
            )),
            (_this.code = code),
            _this
          );
        }
        return NodeError2;
      })(Base);
      codes[code] = NodeError;
    }
    function oneOf(expected, thing) {
      if (Array.isArray(expected)) {
        var len = expected.length;
        return (
          (expected = expected.map(function (i) {
            return String(i);
          })),
          len > 2
            ? "one of ".concat(thing, " ").concat(expected.slice(0, len - 1).join(", "), ", or ") + expected[len - 1]
            : len === 2
            ? "one of ".concat(thing, " ").concat(expected[0], " or ").concat(expected[1])
            : "of ".concat(thing, " ").concat(expected[0])
        );
      } else return "of ".concat(thing, " ").concat(String(expected));
    }
    function startsWith(str, search, pos) {
      return str.substr(!pos || pos < 0 ? 0 : +pos, search.length) === search;
    }
    function endsWith(str, search, this_len) {
      return (
        (this_len === void 0 || this_len > str.length) && (this_len = str.length),
        str.substring(this_len - search.length, this_len) === search
      );
    }
    function includes(str, search, start) {
      return (
        typeof start != "number" && (start = 0),
        start + search.length > str.length ? !1 : str.indexOf(search, start) !== -1
      );
    }
    createErrorType("ERR_AMBIGUOUS_ARGUMENT", 'The "%s" argument is ambiguous. %s', TypeError);
    createErrorType(
      "ERR_INVALID_ARG_TYPE",
      function (name, expected, actual) {
        assert === void 0 && (assert = require_assert()), assert(typeof name == "string", "'name' must be a string");
        var determiner;
        typeof expected == "string" && startsWith(expected, "not ")
          ? ((determiner = "must not be"), (expected = expected.replace(/^not /, "")))
          : (determiner = "must be");
        var msg;
        if (endsWith(name, " argument"))
          msg = "The ".concat(name, " ").concat(determiner, " ").concat(oneOf(expected, "type"));
        else {
          var type = includes(name, ".") ? "property" : "argument";
          msg = 'The "'.concat(name, '" ').concat(type, " ").concat(determiner, " ").concat(oneOf(expected, "type"));
        }
        return (msg += ". Received type ".concat(_typeof(actual))), msg;
      },
      TypeError,
    );
    createErrorType(
      "ERR_INVALID_ARG_VALUE",
      function (name, value) {
        var reason = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : "is invalid";
        util === void 0 && (util = require("util"));
        var inspected = util.inspect(value);
        return (
          inspected.length > 128 && (inspected = "".concat(inspected.slice(0, 128), "...")),
          "The argument '".concat(name, "' ").concat(reason, ". Received ").concat(inspected)
        );
      },
      TypeError,
      RangeError,
    );
    createErrorType(
      "ERR_INVALID_RETURN_VALUE",
      function (input, name, value) {
        var type;
        return (
          value && value.constructor && value.constructor.name
            ? (type = "instance of ".concat(value.constructor.name))
            : (type = "type ".concat(_typeof(value))),
          "Expected ".concat(input, ' to be returned from the "').concat(name, '"') +
            " function but got ".concat(type, ".")
        );
      },
      TypeError,
    );
    createErrorType(
      "ERR_MISSING_ARGS",
      function () {
        for (var _len = arguments.length, args = new Array(_len), _key = 0; _key < _len; _key++)
          args[_key] = arguments[_key];
        assert === void 0 && (assert = require_assert()),
          assert(args.length > 0, "At least one arg needs to be specified");
        var msg = "The ",
          len = args.length;
        switch (
          ((args = args.map(function (a) {
            return '"'.concat(a, '"');
          })),
          len)
        ) {
          case 1:
            msg += "".concat(args[0], " argument");
            break;
          case 2:
            msg += "".concat(args[0], " and ").concat(args[1], " arguments");
            break;
          default:
            (msg += args.slice(0, len - 1).join(", ")), (msg += ", and ".concat(args[len - 1], " arguments"));
            break;
        }
        return "".concat(msg, " must be specified");
      },
      TypeError,
    );
    module2.exports.codes = codes;
  },
});

// assert/build/internal/assert/assertion_error.js
var require_assertion_error = __commonJS({
  "assert/build/internal/assert/assertion_error.js"(exports, module2) {
    "use strict";
    function _objectSpread(target) {
      for (var i = 1; i < arguments.length; i++) {
        var source = arguments[i] != null ? arguments[i] : {},
          ownKeys = Object.keys(source);
        typeof Object.getOwnPropertySymbols == "function" &&
          (ownKeys = ownKeys.concat(
            Object.getOwnPropertySymbols(source).filter(function (sym) {
              return Object.getOwnPropertyDescriptor(source, sym).enumerable;
            }),
          )),
          ownKeys.forEach(function (key) {
            _defineProperty(target, key, source[key]);
          });
      }
      return target;
    }
    function _defineProperty(obj, key, value) {
      return (
        key in obj
          ? Object.defineProperty(obj, key, {
              value,
              enumerable: !0,
              configurable: !0,
              writable: !0,
            })
          : (obj[key] = value),
        obj
      );
    }
    function _classCallCheck(instance, Constructor) {
      if (!(instance instanceof Constructor)) throw new TypeError("Cannot call a class as a function");
    }
    function _defineProperties(target, props) {
      for (var i = 0; i < props.length; i++) {
        var descriptor = props[i];
        (descriptor.enumerable = descriptor.enumerable || !1),
          (descriptor.configurable = !0),
          "value" in descriptor && (descriptor.writable = !0),
          Object.defineProperty(target, descriptor.key, descriptor);
      }
    }
    function _createClass(Constructor, protoProps, staticProps) {
      return (
        protoProps && _defineProperties(Constructor.prototype, protoProps),
        staticProps && _defineProperties(Constructor, staticProps),
        Constructor
      );
    }
    function _possibleConstructorReturn(self, call) {
      return call && (_typeof(call) === "object" || typeof call == "function") ? call : _assertThisInitialized(self);
    }
    function _assertThisInitialized(self) {
      if (self === void 0) throw new ReferenceError("this hasn't been initialised - super() hasn't been called");
      return self;
    }
    function _inherits(subClass, superClass) {
      if (typeof superClass != "function" && superClass !== null)
        throw new TypeError("Super expression must either be null or a function");
      (subClass.prototype = Object.create(superClass && superClass.prototype, {
        constructor: { value: subClass, writable: !0, configurable: !0 },
      })),
        superClass && _setPrototypeOf(subClass, superClass);
    }
    function _wrapNativeSuper(Class) {
      var _cache = typeof Map == "function" ? new Map() : void 0;
      return (
        (_wrapNativeSuper = function (Class2) {
          if (Class2 === null || !_isNativeFunction(Class2)) return Class2;
          if (typeof Class2 != "function") throw new TypeError("Super expression must either be null or a function");
          if (typeof _cache != "undefined") {
            if (_cache.has(Class2)) return _cache.get(Class2);
            _cache.set(Class2, Wrapper);
          }
          function Wrapper() {
            return _construct(Class2, arguments, _getPrototypeOf(this).constructor);
          }
          return (
            (Wrapper.prototype = Object.create(Class2.prototype, {
              constructor: {
                value: Wrapper,
                enumerable: !1,
                writable: !0,
                configurable: !0,
              },
            })),
            _setPrototypeOf(Wrapper, Class2)
          );
        }),
        _wrapNativeSuper(Class)
      );
    }
    function isNativeReflectConstruct() {
      if (typeof Reflect == "undefined" || !Reflect.construct || Reflect.construct.sham) return !1;
      if (typeof Proxy == "function") return !0;
      try {
        return Date.prototype.toString.call(Reflect.construct(Date, [], function () {})), !0;
      } catch {
        return !1;
      }
    }
    function _construct(Parent, args, Class) {
      return (
        isNativeReflectConstruct()
          ? (_construct = Reflect.construct)
          : (_construct = function (Parent2, args2, Class2) {
              var a = [null];
              a.push.apply(a, args2);
              var Constructor = Function.bind.apply(Parent2, a),
                instance = new Constructor();
              return Class2 && _setPrototypeOf(instance, Class2.prototype), instance;
            }),
        _construct.apply(null, arguments)
      );
    }
    function _isNativeFunction(fn) {
      return Function.toString.call(fn).indexOf("[native code]") !== -1;
    }
    function _setPrototypeOf(o, p) {
      return (
        (_setPrototypeOf =
          Object.setPrototypeOf ||
          function (o2, p2) {
            return (o2.__proto__ = p2), o2;
          }),
        _setPrototypeOf(o, p)
      );
    }
    function _getPrototypeOf(o) {
      return (
        (_getPrototypeOf = Object.setPrototypeOf
          ? Object.getPrototypeOf
          : function (o2) {
              return o2.__proto__ || Object.getPrototypeOf(o2);
            }),
        _getPrototypeOf(o)
      );
    }
    function _typeof(obj) {
      return (
        typeof Symbol == "function" && typeof Symbol.iterator == "symbol"
          ? (_typeof = function (obj2) {
              return typeof obj2;
            })
          : (_typeof = function (obj2) {
              return obj2 && typeof Symbol == "function" && obj2.constructor === Symbol && obj2 !== Symbol.prototype
                ? "symbol"
                : typeof obj2;
            }),
        _typeof(obj)
      );
    }
    var _require = require("util"),
      inspect = _require.inspect,
      _require2 = require_errors(),
      ERR_INVALID_ARG_TYPE = _require2.codes.ERR_INVALID_ARG_TYPE;
    function endsWith(str, search, this_len) {
      return (
        (this_len === void 0 || this_len > str.length) && (this_len = str.length),
        str.substring(this_len - search.length, this_len) === search
      );
    }
    function repeat(str, count) {
      if (((count = Math.floor(count)), str.length == 0 || count == 0)) return "";
      var maxCount = str.length * count;
      for (count = Math.floor(Math.log(count) / Math.log(2)); count; ) (str += str), count--;
      return (str += str.substring(0, maxCount - str.length)), str;
    }
    var blue = "",
      green = "",
      red = "",
      white = "",
      kReadableOperator = {
        deepStrictEqual: "Expected values to be strictly deep-equal:",
        strictEqual: "Expected values to be strictly equal:",
        strictEqualObject: 'Expected "actual" to be reference-equal to "expected":',
        deepEqual: "Expected values to be loosely deep-equal:",
        equal: "Expected values to be loosely equal:",
        notDeepStrictEqual: 'Expected "actual" not to be strictly deep-equal to:',
        notStrictEqual: 'Expected "actual" to be strictly unequal to:',
        notStrictEqualObject: 'Expected "actual" not to be reference-equal to "expected":',
        notDeepEqual: 'Expected "actual" not to be loosely deep-equal to:',
        notEqual: 'Expected "actual" to be loosely unequal to:',
        notIdentical: "Values identical but not reference-equal:",
      },
      kMaxShortLength = 10;
    function copyError(source) {
      var keys = Object.keys(source),
        target = Object.create(Object.getPrototypeOf(source));
      return (
        keys.forEach(function (key) {
          target[key] = source[key];
        }),
        Object.defineProperty(target, "message", {
          value: source.message,
        }),
        target
      );
    }
    function inspectValue(val) {
      return inspect(val, {
        compact: !1,
        customInspect: !1,
        depth: 1e3,
        maxArrayLength: 1 / 0,
        showHidden: !1,
        breakLength: 1 / 0,
        showProxy: !1,
        sorted: !0,
        getters: !0,
      });
    }
    function createErrDiff(actual, expected, operator) {
      var other = "",
        res = "",
        lastPos = 0,
        end = "",
        skipped = !1,
        actualInspected = inspectValue(actual),
        actualLines = actualInspected.split(`
`),
        expectedLines = inspectValue(expected).split(`
`),
        i = 0,
        indicator = "";
      if (
        (operator === "strictEqual" &&
          _typeof(actual) === "object" &&
          _typeof(expected) === "object" &&
          actual !== null &&
          expected !== null &&
          (operator = "strictEqualObject"),
        actualLines.length === 1 && expectedLines.length === 1 && actualLines[0] !== expectedLines[0])
      ) {
        var inputLength = actualLines[0].length + expectedLines[0].length;
        if (inputLength <= kMaxShortLength) {
          if (
            (_typeof(actual) !== "object" || actual === null) &&
            (_typeof(expected) !== "object" || expected === null) &&
            (actual !== 0 || expected !== 0)
          )
            return (
              "".concat(
                kReadableOperator[operator],
                `

`,
              ) +
              "".concat(actualLines[0], " !== ").concat(
                expectedLines[0],
                `
`,
              )
            );
        } else if (operator !== "strictEqualObject") {
          var maxLength = process.stderr && process.stderr.isTTY ? process.stderr.columns : 80;
          if (inputLength < maxLength) {
            for (; actualLines[0][i] === expectedLines[0][i]; ) i++;
            i > 2 &&
              ((indicator = `
  `.concat(repeat(" ", i), "^")),
              (i = 0));
          }
        }
      }
      for (
        var a = actualLines[actualLines.length - 1], b = expectedLines[expectedLines.length - 1];
        a === b &&
        (i++ < 2
          ? (end = `
  `
              .concat(a)
              .concat(end))
          : (other = a),
        actualLines.pop(),
        expectedLines.pop(),
        !(actualLines.length === 0 || expectedLines.length === 0));

      )
        (a = actualLines[actualLines.length - 1]), (b = expectedLines[expectedLines.length - 1]);
      var maxLines = Math.max(actualLines.length, expectedLines.length);
      if (maxLines === 0) {
        var _actualLines = actualInspected.split(`
`);
        if (_actualLines.length > 30)
          for (_actualLines[26] = "".concat(blue, "...").concat(white); _actualLines.length > 27; ) _actualLines.pop();
        return ""
          .concat(
            kReadableOperator.notIdentical,
            `

`,
          )
          .concat(
            _actualLines.join(`
`),
            `
`,
          );
      }
      i > 3 &&
        ((end = `
`
          .concat(blue, "...")
          .concat(white)
          .concat(end)),
        (skipped = !0)),
        other !== "" &&
          ((end = `
  `
            .concat(other)
            .concat(end)),
          (other = ""));
      var printedLines = 0,
        msg =
          kReadableOperator[operator] +
          `
`
            .concat(green, "+ actual")
            .concat(white, " ")
            .concat(red, "- expected")
            .concat(white),
        skippedMsg = " ".concat(blue, "...").concat(white, " Lines skipped");
      for (i = 0; i < maxLines; i++) {
        var cur = i - lastPos;
        if (actualLines.length < i + 1)
          cur > 1 &&
            i > 2 &&
            (cur > 4
              ? ((res += `
`
                  .concat(blue, "...")
                  .concat(white)),
                (skipped = !0))
              : cur > 3 &&
                ((res += `
  `.concat(expectedLines[i - 2])),
                printedLines++),
            (res += `
  `.concat(expectedLines[i - 1])),
            printedLines++),
            (lastPos = i),
            (other += `
`
              .concat(red, "-")
              .concat(white, " ")
              .concat(expectedLines[i])),
            printedLines++;
        else if (expectedLines.length < i + 1)
          cur > 1 &&
            i > 2 &&
            (cur > 4
              ? ((res += `
`
                  .concat(blue, "...")
                  .concat(white)),
                (skipped = !0))
              : cur > 3 &&
                ((res += `
  `.concat(actualLines[i - 2])),
                printedLines++),
            (res += `
  `.concat(actualLines[i - 1])),
            printedLines++),
            (lastPos = i),
            (res += `
`
              .concat(green, "+")
              .concat(white, " ")
              .concat(actualLines[i])),
            printedLines++;
        else {
          var expectedLine = expectedLines[i],
            actualLine = actualLines[i],
            divergingLines =
              actualLine !== expectedLine && (!endsWith(actualLine, ",") || actualLine.slice(0, -1) !== expectedLine);
          divergingLines &&
            endsWith(expectedLine, ",") &&
            expectedLine.slice(0, -1) === actualLine &&
            ((divergingLines = !1), (actualLine += ",")),
            divergingLines
              ? (cur > 1 &&
                  i > 2 &&
                  (cur > 4
                    ? ((res += `
`
                        .concat(blue, "...")
                        .concat(white)),
                      (skipped = !0))
                    : cur > 3 &&
                      ((res += `
  `.concat(actualLines[i - 2])),
                      printedLines++),
                  (res += `
  `.concat(actualLines[i - 1])),
                  printedLines++),
                (lastPos = i),
                (res += `
`
                  .concat(green, "+")
                  .concat(white, " ")
                  .concat(actualLine)),
                (other += `
`
                  .concat(red, "-")
                  .concat(white, " ")
                  .concat(expectedLine)),
                (printedLines += 2))
              : ((res += other),
                (other = ""),
                (cur === 1 || i === 0) &&
                  ((res += `
  `.concat(actualLine)),
                  printedLines++));
        }
        if (printedLines > 20 && i < maxLines - 2)
          return (
            ""
              .concat(msg)
              .concat(
                skippedMsg,
                `
`,
              )
              .concat(
                res,
                `
`,
              )
              .concat(blue, "...")
              .concat(white)
              .concat(
                other,
                `
`,
              ) + "".concat(blue, "...").concat(white)
          );
      }
      return ""
        .concat(msg)
        .concat(
          skipped ? skippedMsg : "",
          `
`,
        )
        .concat(res)
        .concat(other)
        .concat(end)
        .concat(indicator);
    }
    var AssertionError = /* @__PURE__ */ (function (_Error) {
      _inherits(AssertionError2, _Error);
      function AssertionError2(options) {
        var _this;
        if ((_classCallCheck(this, AssertionError2), _typeof(options) !== "object" || options === null))
          throw new ERR_INVALID_ARG_TYPE("options", "Object", options);
        var message = options.message,
          operator = options.operator,
          stackStartFn = options.stackStartFn,
          actual = options.actual,
          expected = options.expected,
          limit = Error.stackTraceLimit;
        if (((Error.stackTraceLimit = 0), message != null))
          _this = _possibleConstructorReturn(this, _getPrototypeOf(AssertionError2).call(this, String(message)));
        else if (
          (process.stderr &&
            process.stderr.isTTY &&
            (process.stderr && process.stderr.getColorDepth && process.stderr.getColorDepth() !== 1
              ? ((blue = "[34m"), (green = "[32m"), (white = "[39m"), (red = "[31m"))
              : ((blue = ""), (green = ""), (white = ""), (red = ""))),
          _typeof(actual) === "object" &&
            actual !== null &&
            _typeof(expected) === "object" &&
            expected !== null &&
            "stack" in actual &&
            actual instanceof Error &&
            "stack" in expected &&
            expected instanceof Error &&
            ((actual = copyError(actual)), (expected = copyError(expected))),
          operator === "deepStrictEqual" || operator === "strictEqual")
        )
          _this = _possibleConstructorReturn(
            this,
            _getPrototypeOf(AssertionError2).call(this, createErrDiff(actual, expected, operator)),
          );
        else if (operator === "notDeepStrictEqual" || operator === "notStrictEqual") {
          var base = kReadableOperator[operator],
            res = inspectValue(actual).split(`
`);
          if (
            (operator === "notStrictEqual" &&
              _typeof(actual) === "object" &&
              actual !== null &&
              (base = kReadableOperator.notStrictEqualObject),
            res.length > 30)
          )
            for (res[26] = "".concat(blue, "...").concat(white); res.length > 27; ) res.pop();
          res.length === 1
            ? (_this = _possibleConstructorReturn(
                this,
                _getPrototypeOf(AssertionError2).call(this, "".concat(base, " ").concat(res[0])),
              ))
            : (_this = _possibleConstructorReturn(
                this,
                _getPrototypeOf(AssertionError2).call(
                  this,
                  ""
                    .concat(
                      base,
                      `

`,
                    )
                    .concat(
                      res.join(`
`),
                      `
`,
                    ),
                ),
              ));
        } else {
          var _res = inspectValue(actual),
            other = "",
            knownOperators = kReadableOperator[operator];
          operator === "notDeepEqual" || operator === "notEqual"
            ? ((_res = ""
                .concat(
                  kReadableOperator[operator],
                  `

`,
                )
                .concat(_res)),
              _res.length > 1024 && (_res = "".concat(_res.slice(0, 1021), "...")))
            : ((other = "".concat(inspectValue(expected))),
              _res.length > 512 && (_res = "".concat(_res.slice(0, 509), "...")),
              other.length > 512 && (other = "".concat(other.slice(0, 509), "...")),
              operator === "deepEqual" || operator === "equal"
                ? (_res = ""
                    .concat(
                      knownOperators,
                      `

`,
                    )
                    .concat(
                      _res,
                      `

should equal

`,
                    ))
                : (other = " ".concat(operator, " ").concat(other))),
            (_this = _possibleConstructorReturn(
              this,
              _getPrototypeOf(AssertionError2).call(this, "".concat(_res).concat(other)),
            ));
        }
        return (
          (Error.stackTraceLimit = limit),
          (_this.generatedMessage = !message),
          Object.defineProperty(_assertThisInitialized(_this), "name", {
            value: "AssertionError [ERR_ASSERTION]",
            enumerable: !1,
            writable: !0,
            configurable: !0,
          }),
          (_this.code = "ERR_ASSERTION"),
          (_this.actual = actual),
          (_this.expected = expected),
          (_this.operator = operator),
          Error.captureStackTrace && Error.captureStackTrace(_assertThisInitialized(_this), stackStartFn),
          _this.stack,
          (_this.name = "AssertionError"),
          _possibleConstructorReturn(_this)
        );
      }
      return (
        _createClass(AssertionError2, [
          {
            key: "toString",
            value: function () {
              return "".concat(this.name, " [").concat(this.code, "]: ").concat(this.message);
            },
          },
          {
            key: inspect.custom,
            value: function (recurseTimes, ctx) {
              return inspect(
                this,
                _objectSpread({}, ctx, {
                  customInspect: !1,
                  depth: 0,
                }),
              );
            },
          },
        ]),
        AssertionError2
      );
    })(_wrapNativeSuper(Error));
    module2.exports = AssertionError;
  },
});

// assert/build/assert.js
var require_assert = __commonJS({
  "assert/build/assert.js"(exports, module2) {
    "use strict";
    function _typeof(obj) {
      return (
        typeof Symbol == "function" && typeof Symbol.iterator == "symbol"
          ? (_typeof = function (obj2) {
              return typeof obj2;
            })
          : (_typeof = function (obj2) {
              return obj2 && typeof Symbol == "function" && obj2.constructor === Symbol && obj2 !== Symbol.prototype
                ? "symbol"
                : typeof obj2;
            }),
        _typeof(obj)
      );
    }
    function _classCallCheck(instance, Constructor) {
      if (!(instance instanceof Constructor)) throw new TypeError("Cannot call a class as a function");
    }
    var _require = require_errors(),
      _require$codes = _require.codes,
      ERR_AMBIGUOUS_ARGUMENT = _require$codes.ERR_AMBIGUOUS_ARGUMENT,
      ERR_INVALID_ARG_TYPE = _require$codes.ERR_INVALID_ARG_TYPE,
      ERR_INVALID_ARG_VALUE = _require$codes.ERR_INVALID_ARG_VALUE,
      ERR_INVALID_RETURN_VALUE = _require$codes.ERR_INVALID_RETURN_VALUE,
      ERR_MISSING_ARGS = _require$codes.ERR_MISSING_ARGS,
      AssertionError = require_assertion_error(),
      _require2 = require("util"),
      inspect = _require2.inspect,
      _require$types = require("util").types,
      isPromise = _require$types.isPromise,
      isRegExp = _require$types.isRegExp,
      objectAssign = Object.assign,
      objectIs = Object.is,
      errorCache = new Map();

    var warned = !1,
      assert = (module2.exports = ok),
      NO_EXCEPTION_SENTINEL = {};
    function innerFail(obj) {
      throw obj.message instanceof Error ? obj.message : new AssertionError(obj);
    }
    function fail(actual, expected, message, operator, stackStartFn) {
      var argsLen = arguments.length,
        internalMessage;
      if (argsLen === 0) internalMessage = "Failed";
      else if (argsLen === 1) (message = actual), (actual = void 0);
      else {
        if (warned === !1) {
          warned = !0;
          var warn = process.emitWarning ? process.emitWarning : console.warn.bind(console);
          warn(
            "assert.fail() with more than one argument is deprecated. Please use assert.strictEqual() instead or only pass a message.",
            "DeprecationWarning",
            "DEP0094",
          );
        }
        argsLen === 2 && (operator = "!=");
      }
      if (message instanceof Error) throw message;
      var errArgs = {
        actual,
        expected,
        operator: operator === void 0 ? "fail" : operator,
        stackStartFn: stackStartFn || fail,
      };
      message !== void 0 && (errArgs.message = message);
      var err = new AssertionError(errArgs);
      throw (internalMessage && ((err.message = internalMessage), (err.generatedMessage = !0)), err);
    }
    assert.fail = fail;
    assert.AssertionError = AssertionError;
    function innerOk(fn, argLen, value, message) {
      if (!value) {
        var generatedMessage = !1;
        if (argLen === 0) (generatedMessage = !0), (message = "No value argument passed to `assert.ok()`");
        else if (message instanceof Error) throw message;
        var err = new AssertionError({
          actual: value,
          expected: !0,
          message,
          operator: "==",
          stackStartFn: fn,
        });
        throw ((err.generatedMessage = generatedMessage), err);
      }
    }
    function ok() {
      for (var _len = arguments.length, args = new Array(_len), _key = 0; _key < _len; _key++)
        args[_key] = arguments[_key];
      innerOk.apply(void 0, [ok, args.length].concat(args));
    }
    assert.ok = ok;
    assert.equal = function equal(actual, expected, message) {
      if (arguments.length < 2) throw new ERR_MISSING_ARGS("actual", "expected");
      actual != expected &&
        innerFail({
          actual,
          expected,
          message,
          operator: "==",
          stackStartFn: equal,
        });
    };
    assert.notEqual = function notEqual(actual, expected, message) {
      if (arguments.length < 2) throw new ERR_MISSING_ARGS("actual", "expected");
      actual == expected &&
        innerFail({
          actual,
          expected,
          message,
          operator: "!=",
          stackStartFn: notEqual,
        });
    };
    assert.deepEqual = function deepEqual(actual, expected, message) {
      if (arguments.length < 2) throw new ERR_MISSING_ARGS("actual", "expected");
      isDeepEqual(actual, expected, false) ||
        innerFail({
          actual,
          expected,
          message,
          operator: "deepEqual",
          stackStartFn: deepEqual,
        });
    };
    assert.notDeepEqual = function notDeepEqual(actual, expected, message) {
      if (arguments.length < 2) throw new ERR_MISSING_ARGS("actual", "expected");
      isDeepEqual(actual, expected, false) &&
        innerFail({
          actual,
          expected,
          message,
          operator: "notDeepEqual",
          stackStartFn: notDeepEqual,
        });
    };
    assert.deepStrictEqual = function deepStrictEqual(actual, expected, message) {
      if (arguments.length < 2) throw new ERR_MISSING_ARGS("actual", "expected");

      isDeepEqual(actual, expected, true) ||
        innerFail({
          actual,
          expected,
          message,
          operator: "deepStrictEqual",
          stackStartFn: deepStrictEqual,
        });
    };
    assert.notDeepStrictEqual = notDeepStrictEqual;
    function notDeepStrictEqual(actual, expected, message) {
      if (arguments.length < 2) throw new ERR_MISSING_ARGS("actual", "expected");

      isDeepEqual(actual, expected, true) &&
        innerFail({
          actual,
          expected,
          message,
          operator: "notDeepStrictEqual",
          stackStartFn: notDeepStrictEqual,
        });
    }
    assert.strictEqual = function strictEqual(actual, expected, message) {
      if (arguments.length < 2) throw new ERR_MISSING_ARGS("actual", "expected");
      objectIs(actual, expected) ||
        innerFail({
          actual,
          expected,
          message,
          operator: "strictEqual",
          stackStartFn: strictEqual,
        });
    };
    assert.notStrictEqual = function notStrictEqual(actual, expected, message) {
      if (arguments.length < 2) throw new ERR_MISSING_ARGS("actual", "expected");
      objectIs(actual, expected) &&
        innerFail({
          actual,
          expected,
          message,
          operator: "notStrictEqual",
          stackStartFn: notStrictEqual,
        });
    };
    assert.match = function match(actual, expected, message) {
      if (arguments.length < 2) throw new ERR_MISSING_ARGS("actual", "expected");
      if (!isRegExp(expected)) throw new ERR_INVALID_ARG_TYPE("expected", "RegExp", expected);
      expected.test(actual) ||
        innerFail({
          actual,
          expected,
          message,
          operator: "match",
          stackStartFn: match,
        });
    };
    var Comparison = function Comparison2(obj, keys, actual) {
      var _this = this;
      _classCallCheck(this, Comparison2),
        keys.forEach(function (key) {
          key in obj &&
            (actual !== void 0 && typeof actual[key] == "string" && isRegExp(obj[key]) && obj[key].test(actual[key])
              ? (_this[key] = actual[key])
              : (_this[key] = obj[key]));
        });
    };
    function compareExceptionKey(actual, expected, key, message, keys, fn) {
      if (!(key in actual) || !isDeepEqual(actual[key], expected[key], true)) {
        if (!message) {
          var a = new Comparison(actual, keys),
            b = new Comparison(expected, keys, actual),
            err = new AssertionError({
              actual: a,
              expected: b,
              operator: "deepStrictEqual",
              stackStartFn: fn,
            });
          throw ((err.actual = actual), (err.expected = expected), (err.operator = fn.name), err);
        }
        innerFail({
          actual,
          expected,
          message,
          operator: fn.name,
          stackStartFn: fn,
        });
      }
    }
    function expectedException(actual, expected, msg, fn) {
      if (typeof expected != "function") {
        if (isRegExp(expected)) return expected.test(actual);
        if (arguments.length === 2) throw new ERR_INVALID_ARG_TYPE("expected", ["Function", "RegExp"], expected);
        if (_typeof(actual) !== "object" || actual === null) {
          var err = new AssertionError({
            actual,
            expected,
            message: msg,
            operator: "deepStrictEqual",
            stackStartFn: fn,
          });
          throw ((err.operator = fn.name), err);
        }
        var keys = Object.keys(expected);
        if (expected instanceof Error) keys.push("name", "message");
        else if (keys.length === 0) throw new ERR_INVALID_ARG_VALUE("error", expected, "may not be an empty object");
        return (
          keys.forEach(function (key) {
            return (
              (typeof actual[key] == "string" && isRegExp(expected[key]) && expected[key].test(actual[key])) ||
              compareExceptionKey(actual, expected, key, msg, keys, fn)
            );
          }),
          !0
        );
      }
      return expected.prototype !== void 0 && actual instanceof expected
        ? !0
        : Error.isPrototypeOf(expected)
        ? !1
        : expected.call({}, actual) === !0;
    }
    function getActual(fn) {
      if (typeof fn != "function") throw new ERR_INVALID_ARG_TYPE("fn", "Function", fn);
      try {
        fn();
      } catch (e) {
        return e;
      }
      return NO_EXCEPTION_SENTINEL;
    }
    function checkIsPromise(obj) {
      return (
        isPromise(obj) ||
        (obj !== null && _typeof(obj) === "object" && typeof obj.then == "function" && typeof obj.catch == "function")
      );
    }
    function waitForActual(promiseFn) {
      return Promise.resolve().then(function () {
        var resultPromise;
        if (typeof promiseFn == "function") {
          if (((resultPromise = promiseFn()), !checkIsPromise(resultPromise)))
            throw new ERR_INVALID_RETURN_VALUE("instance of Promise", "promiseFn", resultPromise);
        } else if (checkIsPromise(promiseFn)) resultPromise = promiseFn;
        else throw new ERR_INVALID_ARG_TYPE("promiseFn", ["Function", "Promise"], promiseFn);
        return Promise.resolve()
          .then(function () {
            return resultPromise;
          })
          .then(function () {
            return NO_EXCEPTION_SENTINEL;
          })
          .catch(function (e) {
            return e;
          });
      });
    }
    function expectsError(stackStartFn, actual, error, message) {
      if (typeof error == "string") {
        if (arguments.length === 4)
          throw new ERR_INVALID_ARG_TYPE("error", ["Object", "Error", "Function", "RegExp"], error);
        if (_typeof(actual) === "object" && actual !== null) {
          if (actual.message === error)
            throw new ERR_AMBIGUOUS_ARGUMENT(
              "error/message",
              'The error message "'.concat(actual.message, '" is identical to the message.'),
            );
        } else if (actual === error)
          throw new ERR_AMBIGUOUS_ARGUMENT(
            "error/message",
            'The error "'.concat(actual, '" is identical to the message.'),
          );
        (message = error), (error = void 0);
      } else if (error != null && _typeof(error) !== "object" && typeof error != "function")
        throw new ERR_INVALID_ARG_TYPE("error", ["Object", "Error", "Function", "RegExp"], error);
      if (actual === NO_EXCEPTION_SENTINEL) {
        var details = "";
        error && error.name && (details += " (".concat(error.name, ")")),
          (details += message ? ": ".concat(message) : ".");
        var fnType = stackStartFn.name === "rejects" ? "rejection" : "exception";
        innerFail({
          actual: void 0,
          expected: error,
          operator: stackStartFn.name,
          message: "Missing expected ".concat(fnType).concat(details),
          stackStartFn,
        });
      }
      if (error && !expectedException(actual, error, message, stackStartFn)) throw actual;
    }
    function expectsNoError(stackStartFn, actual, error, message) {
      if (actual !== NO_EXCEPTION_SENTINEL) {
        if (
          (typeof error == "string" && ((message = error), (error = void 0)),
          !error || expectedException(actual, error))
        ) {
          var details = message ? ": ".concat(message) : ".",
            fnType = stackStartFn.name === "doesNotReject" ? "rejection" : "exception";
          innerFail({
            actual,
            expected: error,
            operator: stackStartFn.name,
            message:
              "Got unwanted ".concat(fnType).concat(
                details,
                `
`,
              ) + 'Actual message: "'.concat(actual && actual.message, '"'),
            stackStartFn,
          });
        }
        throw actual;
      }
    }
    assert.throws = function throws(promiseFn) {
      for (var _len2 = arguments.length, args = new Array(_len2 > 1 ? _len2 - 1 : 0), _key2 = 1; _key2 < _len2; _key2++)
        args[_key2 - 1] = arguments[_key2];
      expectsError.apply(void 0, [throws, getActual(promiseFn)].concat(args));
    };
    assert.rejects = function rejects(promiseFn) {
      for (var _len3 = arguments.length, args = new Array(_len3 > 1 ? _len3 - 1 : 0), _key3 = 1; _key3 < _len3; _key3++)
        args[_key3 - 1] = arguments[_key3];
      return waitForActual(promiseFn).then(function (result) {
        return expectsError.apply(void 0, [rejects, result].concat(args));
      });
    };
    assert.doesNotThrow = function doesNotThrow(fn) {
      for (var _len4 = arguments.length, args = new Array(_len4 > 1 ? _len4 - 1 : 0), _key4 = 1; _key4 < _len4; _key4++)
        args[_key4 - 1] = arguments[_key4];
      expectsNoError.apply(void 0, [doesNotThrow, getActual(fn)].concat(args));
    };
    assert.doesNotReject = function doesNotReject(fn) {
      for (var _len5 = arguments.length, args = new Array(_len5 > 1 ? _len5 - 1 : 0), _key5 = 1; _key5 < _len5; _key5++)
        args[_key5 - 1] = arguments[_key5];
      return waitForActual(fn).then(function (result) {
        return expectsNoError.apply(void 0, [doesNotReject, result].concat(args));
      });
    };
    assert.ifError = function ifError(err) {
      if (err != null) {
        var message = "ifError got unwanted exception: ";
        _typeof(err) === "object" && typeof err.message == "string"
          ? err.message.length === 0 && err.constructor
            ? (message += err.constructor.name)
            : (message += err.message)
          : (message += inspect(err));
        var newErr = new AssertionError({
            actual: err,
            expected: null,
            operator: "ifError",
            message,
            stackStartFn: ifError,
          }),
          origStack = err.stack;
        if (typeof origStack == "string") {
          var tmp2 = origStack.split(`
`);
          tmp2.shift();
          for (
            var tmp1 = newErr.stack.split(`
`),
              i = 0;
            i < tmp2.length;
            i++
          ) {
            var pos = tmp1.indexOf(tmp2[i]);
            if (pos !== -1) {
              tmp1 = tmp1.slice(0, pos);
              break;
            }
          }
          newErr.stack = ""
            .concat(
              tmp1.join(`
`),
              `
`,
            )
            .concat(
              tmp2.join(`
`),
            );
        }
        throw newErr;
      }
    };
    function strict() {
      for (var _len6 = arguments.length, args = new Array(_len6), _key6 = 0; _key6 < _len6; _key6++)
        args[_key6] = arguments[_key6];
      innerOk.apply(void 0, [strict, args.length].concat(args));
    }
    assert.strict = objectAssign(strict, assert, {
      equal: assert.strictEqual,
      deepEqual: assert.deepStrictEqual,
      notEqual: assert.notStrictEqual,
      notDeepEqual: assert.notDeepStrictEqual,
    });
    assert.strict.strict = assert.strict;
  },
});
var assert_module = require_assert();

function CallTracker() {
  throw new Error("CallTracker is not supported yet");
}

assert_module[Symbol.for("CommonJS")] = 0;
assert_module["CallTracker"] = CallTracker;
export var {
  AssertionError,
  assert,
  deepEqual,
  deepStrictEqual,
  doesNotReject,
  doesNotThrow,
  equal,
  fail,
  ifError,
  notDeepEqual,
  notDeepStrictEqual,
  notEqual,
  notStrictEqual,
  ok,
  rejects,
  strict,
  strictEqual,
  throws,
} = assert_module;
export default assert_module;
