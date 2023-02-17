/** @license React v17.0.2
 * react.development.js
 *
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
(function (global, factory) {
  typeof exports === "object" && typeof module !== "undefined"
    ? factory(exports)
    : typeof define === "function" && define.amd
    ? define(["exports"], factory)
    : ((global = global || self), factory((global.React = {})));
})(this, function (exports) {
  "use strict";

  // TODO: this is special because it gets imported during build.
  var ReactVersion = "17.0.2";

  // ATTENTION
  // When adding new symbols to this file,
  // Please consider also adding to 'react-devtools-shared/src/backend/ReactSymbols'
  // The Symbol used to tag the ReactElement-like types. If there is no native Symbol
  // nor polyfill, then a plain number is used for performance.
  var REACT_ELEMENT_TYPE = 0xeac7;
  var REACT_PORTAL_TYPE = 0xeaca;
  exports.Fragment = 0xeacb;
  exports.StrictMode = 0xeacc;
  exports.Profiler = 0xead2;
  var REACT_PROVIDER_TYPE = 0xeacd;
  var REACT_CONTEXT_TYPE = 0xeace;
  var REACT_FORWARD_REF_TYPE = 0xead0;
  exports.Suspense = 0xead1;
  var REACT_SUSPENSE_LIST_TYPE = 0xead8;
  var REACT_MEMO_TYPE = 0xead3;
  var REACT_LAZY_TYPE = 0xead4;
  var REACT_BLOCK_TYPE = 0xead9;
  var REACT_SERVER_BLOCK_TYPE = 0xeada;
  var REACT_FUNDAMENTAL_TYPE = 0xead5;
  var REACT_SCOPE_TYPE = 0xead7;
  var REACT_OPAQUE_ID_TYPE = 0xeae0;
  var REACT_DEBUG_TRACING_MODE_TYPE = 0xeae1;
  var REACT_OFFSCREEN_TYPE = 0xeae2;
  var REACT_LEGACY_HIDDEN_TYPE = 0xeae3;

  if (typeof Symbol === "function" && Symbol.for) {
    var symbolFor = Symbol.for;
    REACT_ELEMENT_TYPE = symbolFor("react.element");
    REACT_PORTAL_TYPE = symbolFor("react.portal");
    exports.Fragment = symbolFor("react.fragment");
    exports.StrictMode = symbolFor("react.strict_mode");
    exports.Profiler = symbolFor("react.profiler");
    REACT_PROVIDER_TYPE = symbolFor("react.provider");
    REACT_CONTEXT_TYPE = symbolFor("react.context");
    REACT_FORWARD_REF_TYPE = symbolFor("react.forward_ref");
    exports.Suspense = symbolFor("react.suspense");
    REACT_SUSPENSE_LIST_TYPE = symbolFor("react.suspense_list");
    REACT_MEMO_TYPE = symbolFor("react.memo");
    REACT_LAZY_TYPE = symbolFor("react.lazy");
    REACT_BLOCK_TYPE = symbolFor("react.block");
    REACT_SERVER_BLOCK_TYPE = symbolFor("react.server.block");
    REACT_FUNDAMENTAL_TYPE = symbolFor("react.fundamental");
    REACT_SCOPE_TYPE = symbolFor("react.scope");
    REACT_OPAQUE_ID_TYPE = symbolFor("react.opaque.id");
    REACT_DEBUG_TRACING_MODE_TYPE = symbolFor("react.debug_trace_mode");
    REACT_OFFSCREEN_TYPE = symbolFor("react.offscreen");
    REACT_LEGACY_HIDDEN_TYPE = symbolFor("react.legacy_hidden");
  }

  var MAYBE_ITERATOR_SYMBOL = typeof Symbol === "function" && Symbol.iterator;
  var FAUX_ITERATOR_SYMBOL = "@@iterator";
  function getIteratorFn(maybeIterable) {
    if (maybeIterable === null || typeof maybeIterable !== "object") {
      return null;
    }

    var maybeIterator =
      (MAYBE_ITERATOR_SYMBOL && maybeIterable[MAYBE_ITERATOR_SYMBOL]) ||
      maybeIterable[FAUX_ITERATOR_SYMBOL];

    if (typeof maybeIterator === "function") {
      return maybeIterator;
    }

    return null;
  }

  var hasOwnProperty = Object.prototype.hasOwnProperty;

  var _assign = function (to, from) {
    for (var key in from) {
      if (hasOwnProperty.call(from, key)) {
        to[key] = from[key];
      }
    }
  };

  var assign =
    Object.assign ||
    function (target, sources) {
      if (target == null) {
        throw new TypeError("Object.assign target cannot be null or undefined");
      }

      var to = Object(target);

      for (var nextIndex = 1; nextIndex < arguments.length; nextIndex++) {
        var nextSource = arguments[nextIndex];

        if (nextSource != null) {
          _assign(to, Object(nextSource));
        }
      }

      return to;
    };

  /**
   * Keeps track of the current dispatcher.
   */
  var ReactCurrentDispatcher = {
    /**
     * @internal
     * @type {ReactComponent}
     */
    current: null,
  };

  /**
   * Keeps track of the current batch's configuration such as how long an update
   * should suspend for if it needs to.
   */
  var ReactCurrentBatchConfig = {
    transition: 0,
  };

  /**
   * Keeps track of the current owner.
   *
   * The current owner is the component who should own any components that are
   * currently being constructed.
   */
  var ReactCurrentOwner = {
    /**
     * @internal
     * @type {ReactComponent}
     */
    current: null,
  };

  var ReactDebugCurrentFrame = {};
  var currentExtraStackFrame = null;
  function setExtraStackFrame(stack) {
    {
      currentExtraStackFrame = stack;
    }
  }

  {
    ReactDebugCurrentFrame.setExtraStackFrame = function (stack) {
      {
        currentExtraStackFrame = stack;
      }
    }; // Stack implementation injected by the current renderer.

    ReactDebugCurrentFrame.getCurrentStack = null;

    ReactDebugCurrentFrame.getStackAddendum = function () {
      var stack = ""; // Add an extra top frame while an element is being validated

      if (currentExtraStackFrame) {
        stack += currentExtraStackFrame;
      } // Delegate to the injected renderer-specific implementation

      var impl = ReactDebugCurrentFrame.getCurrentStack;

      if (impl) {
        stack += impl() || "";
      }

      return stack;
    };
  }

  /**
   * Used by act() to track whether you're inside an act() scope.
   */
  var IsSomeRendererActing = {
    current: false,
  };

  var ReactSharedInternals = {
    ReactCurrentDispatcher: ReactCurrentDispatcher,
    ReactCurrentBatchConfig: ReactCurrentBatchConfig,
    ReactCurrentOwner: ReactCurrentOwner,
    IsSomeRendererActing: IsSomeRendererActing,
    // Used by renderers to avoid bundling object-assign twice in UMD bundles:
    assign: assign,
  };

  {
    ReactSharedInternals.ReactDebugCurrentFrame = ReactDebugCurrentFrame;
  }

  // by calls to these methods by a Babel plugin.
  //
  // In PROD (or in packages without access to React internals),
  // they are left as they are instead.

  function warn(format) {
    {
      for (
        var _len = arguments.length,
          args = new Array(_len > 1 ? _len - 1 : 0),
          _key = 1;
        _key < _len;
        _key++
      ) {
        args[_key - 1] = arguments[_key];
      }

      printWarning("warn", format, args);
    }
  }
  function error(format) {
    {
      for (
        var _len2 = arguments.length,
          args = new Array(_len2 > 1 ? _len2 - 1 : 0),
          _key2 = 1;
        _key2 < _len2;
        _key2++
      ) {
        args[_key2 - 1] = arguments[_key2];
      }

      printWarning("error", format, args);
    }
  }

  function printWarning(level, format, args) {
    // When changing this logic, you might want to also
    // update consoleWithStackDev.www.js as well.
    {
      var ReactDebugCurrentFrame = ReactSharedInternals.ReactDebugCurrentFrame;
      var stack = ReactDebugCurrentFrame.getStackAddendum();

      if (stack !== "") {
        format += "%s";
        args = args.concat([stack]);
      }

      var argsWithFormat = args.map(function (item) {
        return "" + item;
      }); // Careful: RN currently depends on this prefix

      argsWithFormat.unshift("Warning: " + format); // We intentionally don't use spread (or .apply) directly because it
      // breaks IE9: https://github.com/facebook/react/issues/13610
      // eslint-disable-next-line react-internal/no-production-logging

      Function.prototype.apply.call(console[level], console, argsWithFormat);
    }
  }

  var didWarnStateUpdateForUnmountedComponent = {};

  function warnNoop(publicInstance, callerName) {
    {
      var _constructor = publicInstance.constructor;
      var componentName =
        (_constructor && (_constructor.displayName || _constructor.name)) ||
        "ReactClass";
      var warningKey = componentName + "." + callerName;

      if (didWarnStateUpdateForUnmountedComponent[warningKey]) {
        return;
      }

      error(
        "Can't call %s on a component that is not yet mounted. " +
          "This is a no-op, but it might indicate a bug in your application. " +
          "Instead, assign to `this.state` directly or define a `state = {};` " +
          "class property with the desired state in the %s component.",
        callerName,
        componentName,
      );

      didWarnStateUpdateForUnmountedComponent[warningKey] = true;
    }
  }
  /**
   * This is the abstract API for an update queue.
   */

  var ReactNoopUpdateQueue = {
    /**
     * Checks whether or not this composite component is mounted.
     * @param {ReactClass} publicInstance The instance we want to test.
     * @return {boolean} True if mounted, false otherwise.
     * @protected
     * @final
     */
    isMounted: function (publicInstance) {
      return false;
    },

    /**
     * Forces an update. This should only be invoked when it is known with
     * certainty that we are **not** in a DOM transaction.
     *
     * You may want to call this when you know that some deeper aspect of the
     * component's state has changed but `setState` was not called.
     *
     * This will not invoke `shouldComponentUpdate`, but it will invoke
     * `componentWillUpdate` and `componentDidUpdate`.
     *
     * @param {ReactClass} publicInstance The instance that should rerender.
     * @param {?function} callback Called after component is updated.
     * @param {?string} callerName name of the calling function in the public API.
     * @internal
     */
    enqueueForceUpdate: function (publicInstance, callback, callerName) {
      warnNoop(publicInstance, "forceUpdate");
    },

    /**
     * Replaces all of the state. Always use this or `setState` to mutate state.
     * You should treat `this.state` as immutable.
     *
     * There is no guarantee that `this.state` will be immediately updated, so
     * accessing `this.state` after calling this method may return the old value.
     *
     * @param {ReactClass} publicInstance The instance that should rerender.
     * @param {object} completeState Next state.
     * @param {?function} callback Called after component is updated.
     * @param {?string} callerName name of the calling function in the public API.
     * @internal
     */
    enqueueReplaceState: function (
      publicInstance,
      completeState,
      callback,
      callerName,
    ) {
      warnNoop(publicInstance, "replaceState");
    },

    /**
     * Sets a subset of the state. This only exists because _pendingState is
     * internal. This provides a merging strategy that is not available to deep
     * properties which is confusing. TODO: Expose pendingState or don't use it
     * during the merge.
     *
     * @param {ReactClass} publicInstance The instance that should rerender.
     * @param {object} partialState Next partial state to be merged with state.
     * @param {?function} callback Called after component is updated.
     * @param {?string} Name of the calling function in the public API.
     * @internal
     */
    enqueueSetState: function (
      publicInstance,
      partialState,
      callback,
      callerName,
    ) {
      warnNoop(publicInstance, "setState");
    },
  };

  var emptyObject = {};

  {
    Object.freeze(emptyObject);
  }
  /**
   * Base class helpers for the updating state of a component.
   */

  function Component(props, context, updater) {
    this.props = props;
    this.context = context; // If a component has string refs, we will assign a different object later.

    this.refs = emptyObject; // We initialize the default updater but the real one gets injected by the
    // renderer.

    this.updater = updater || ReactNoopUpdateQueue;
  }

  Component.prototype.isReactComponent = {};
  /**
   * Sets a subset of the state. Always use this to mutate
   * state. You should treat `this.state` as immutable.
   *
   * There is no guarantee that `this.state` will be immediately updated, so
   * accessing `this.state` after calling this method may return the old value.
   *
   * There is no guarantee that calls to `setState` will run synchronously,
   * as they may eventually be batched together.  You can provide an optional
   * callback that will be executed when the call to setState is actually
   * completed.
   *
   * When a function is provided to setState, it will be called at some point in
   * the future (not synchronously). It will be called with the up to date
   * component arguments (state, props, context). These values can be different
   * from this.* because your function may be called after receiveProps but before
   * shouldComponentUpdate, and this new state, props, and context will not yet be
   * assigned to this.
   *
   * @param {object|function} partialState Next partial state or function to
   *        produce next partial state to be merged with current state.
   * @param {?function} callback Called after state is updated.
   * @final
   * @protected
   */

  Component.prototype.setState = function (partialState, callback) {
    if (
      !(
        typeof partialState === "object" ||
        typeof partialState === "function" ||
        partialState == null
      )
    ) {
      {
        throw Error(
          "setState(...): takes an object of state variables to update or a function which returns an object of state variables.",
        );
      }
    }

    this.updater.enqueueSetState(this, partialState, callback, "setState");
  };
  /**
   * Forces an update. This should only be invoked when it is known with
   * certainty that we are **not** in a DOM transaction.
   *
   * You may want to call this when you know that some deeper aspect of the
   * component's state has changed but `setState` was not called.
   *
   * This will not invoke `shouldComponentUpdate`, but it will invoke
   * `componentWillUpdate` and `componentDidUpdate`.
   *
   * @param {?function} callback Called after update is complete.
   * @final
   * @protected
   */

  Component.prototype.forceUpdate = function (callback) {
    this.updater.enqueueForceUpdate(this, callback, "forceUpdate");
  };
  /**
   * Deprecated APIs. These APIs used to exist on classic React classes but since
   * we would like to deprecate them, we're not going to move them over to this
   * modern base class. Instead, we define a getter that warns if it's accessed.
   */

  {
    var deprecatedAPIs = {
      isMounted: [
        "isMounted",
        "Instead, make sure to clean up subscriptions and pending requests in " +
          "componentWillUnmount to prevent memory leaks.",
      ],
      replaceState: [
        "replaceState",
        "Refactor your code to use setState instead (see " +
          "https://github.com/facebook/react/issues/3236).",
      ],
    };

    var defineDeprecationWarning = function (methodName, info) {
      Object.defineProperty(Component.prototype, methodName, {
        get: function () {
          warn(
            "%s(...) is deprecated in plain JavaScript React classes. %s",
            info[0],
            info[1],
          );

          return undefined;
        },
      });
    };

    for (var fnName in deprecatedAPIs) {
      if (deprecatedAPIs.hasOwnProperty(fnName)) {
        defineDeprecationWarning(fnName, deprecatedAPIs[fnName]);
      }
    }
  }

  function ComponentDummy() {}

  ComponentDummy.prototype = Component.prototype;
  /**
   * Convenience component with default shallow equality check for sCU.
   */

  function PureComponent(props, context, updater) {
    this.props = props;
    this.context = context; // If a component has string refs, we will assign a different object later.

    this.refs = emptyObject;
    this.updater = updater || ReactNoopUpdateQueue;
  }

  var pureComponentPrototype = (PureComponent.prototype = new ComponentDummy());
  pureComponentPrototype.constructor = PureComponent; // Avoid an extra prototype jump for these methods.

  assign(pureComponentPrototype, Component.prototype);

  pureComponentPrototype.isPureReactComponent = true;

  // an immutable object with a single mutable value
  function createRef() {
    var refObject = {
      current: null,
    };

    {
      Object.seal(refObject);
    }

    return refObject;
  }

  function getWrappedName(outerType, innerType, wrapperName) {
    var functionName = innerType.displayName || innerType.name || "";
    return (
      outerType.displayName ||
      (functionName !== ""
        ? wrapperName + "(" + functionName + ")"
        : wrapperName)
    );
  }

  function getContextName(type) {
    return type.displayName || "Context";
  }

  function getComponentName(type) {
    if (type == null) {
      // Host root, text node or just invalid type.
      return null;
    }

    {
      if (typeof type.tag === "number") {
        error(
          "Received an unexpected object in getComponentName(). " +
            "This is likely a bug in React. Please file an issue.",
        );
      }
    }

    if (typeof type === "function") {
      return type.displayName || type.name || null;
    }

    if (typeof type === "string") {
      return type;
    }

    switch (type) {
      case exports.Fragment:
        return "Fragment";

      case REACT_PORTAL_TYPE:
        return "Portal";

      case exports.Profiler:
        return "Profiler";

      case exports.StrictMode:
        return "StrictMode";

      case exports.Suspense:
        return "Suspense";

      case REACT_SUSPENSE_LIST_TYPE:
        return "SuspenseList";
    }

    if (typeof type === "object") {
      switch (type.$$typeof) {
        case REACT_CONTEXT_TYPE:
          var context = type;
          return getContextName(context) + ".Consumer";

        case REACT_PROVIDER_TYPE:
          var provider = type;
          return getContextName(provider._context) + ".Provider";

        case REACT_FORWARD_REF_TYPE:
          return getWrappedName(type, type.render, "ForwardRef");

        case REACT_MEMO_TYPE:
          return getComponentName(type.type);

        case REACT_BLOCK_TYPE:
          return getComponentName(type._render);

        case REACT_LAZY_TYPE: {
          var lazyComponent = type;
          var payload = lazyComponent._payload;
          var init = lazyComponent._init;

          try {
            return getComponentName(init(payload));
          } catch (x) {
            return null;
          }
        }
      }
    }

    return null;
  }

  var hasOwnProperty$1 = Object.prototype.hasOwnProperty;
  var RESERVED_PROPS = {
    key: true,
    ref: true,
    __self: true,
    __source: true,
  };
  var specialPropKeyWarningShown,
    specialPropRefWarningShown,
    didWarnAboutStringRefs;

  {
    didWarnAboutStringRefs = {};
  }

  function hasValidRef(config) {
    {
      if (hasOwnProperty$1.call(config, "ref")) {
        var getter = Object.getOwnPropertyDescriptor(config, "ref").get;

        if (getter && getter.isReactWarning) {
          return false;
        }
      }
    }

    return config.ref !== undefined;
  }

  function hasValidKey(config) {
    {
      if (hasOwnProperty$1.call(config, "key")) {
        var getter = Object.getOwnPropertyDescriptor(config, "key").get;

        if (getter && getter.isReactWarning) {
          return false;
        }
      }
    }

    return config.key !== undefined;
  }

  function defineKeyPropWarningGetter(props, displayName) {
    var warnAboutAccessingKey = function () {
      {
        if (!specialPropKeyWarningShown) {
          specialPropKeyWarningShown = true;

          error(
            "%s: `key` is not a prop. Trying to access it will result " +
              "in `undefined` being returned. If you need to access the same " +
              "value within the child component, you should pass it as a different " +
              "prop. (https://reactjs.org/link/special-props)",
            displayName,
          );
        }
      }
    };

    warnAboutAccessingKey.isReactWarning = true;
    Object.defineProperty(props, "key", {
      get: warnAboutAccessingKey,
      configurable: true,
    });
  }

  function defineRefPropWarningGetter(props, displayName) {
    var warnAboutAccessingRef = function () {
      {
        if (!specialPropRefWarningShown) {
          specialPropRefWarningShown = true;

          error(
            "%s: `ref` is not a prop. Trying to access it will result " +
              "in `undefined` being returned. If you need to access the same " +
              "value within the child component, you should pass it as a different " +
              "prop. (https://reactjs.org/link/special-props)",
            displayName,
          );
        }
      }
    };

    warnAboutAccessingRef.isReactWarning = true;
    Object.defineProperty(props, "ref", {
      get: warnAboutAccessingRef,
      configurable: true,
    });
  }

  function warnIfStringRefCannotBeAutoConverted(config) {
    {
      if (
        typeof config.ref === "string" &&
        ReactCurrentOwner.current &&
        config.__self &&
        ReactCurrentOwner.current.stateNode !== config.__self
      ) {
        var componentName = getComponentName(ReactCurrentOwner.current.type);

        if (!didWarnAboutStringRefs[componentName]) {
          error(
            'Component "%s" contains the string ref "%s". ' +
              "Support for string refs will be removed in a future major release. " +
              "This case cannot be automatically converted to an arrow function. " +
              "We ask you to manually fix this case by using useRef() or createRef() instead. " +
              "Learn more about using refs safely here: " +
              "https://reactjs.org/link/strict-mode-string-ref",
            componentName,
            config.ref,
          );

          didWarnAboutStringRefs[componentName] = true;
        }
      }
    }
  }
  /**
   * Factory method to create a new React element. This no longer adheres to
   * the class pattern, so do not use new to call it. Also, instanceof check
   * will not work. Instead test $$typeof field against Symbol.for('react.element') to check
   * if something is a React Element.
   *
   * @param {*} type
   * @param {*} props
   * @param {*} key
   * @param {string|object} ref
   * @param {*} owner
   * @param {*} self A *temporary* helper to detect places where `this` is
   * different from the `owner` when React.createElement is called, so that we
   * can warn. We want to get rid of owner and replace string `ref`s with arrow
   * functions, and as long as `this` and owner are the same, there will be no
   * change in behavior.
   * @param {*} source An annotation object (added by a transpiler or otherwise)
   * indicating filename, line number, and/or other information.
   * @internal
   */

  var ReactElement = function (type, key, ref, self, source, owner, props) {
    var element = {
      // This tag allows us to uniquely identify this as a React Element
      $$typeof: REACT_ELEMENT_TYPE,
      // Built-in properties that belong on the element
      type: type,
      key: key,
      ref: ref,
      props: props,
      // Record the component responsible for creating this element.
      _owner: owner,
    };

    {
      // The validation flag is currently mutative. We put it on
      // an external backing store so that we can freeze the whole object.
      // This can be replaced with a WeakMap once they are implemented in
      // commonly used development environments.
      element._store = {}; // To make comparing ReactElements easier for testing purposes, we make
      // the validation flag non-enumerable (where possible, which should
      // include every environment we run tests in), so the test framework
      // ignores it.

      Object.defineProperty(element._store, "validated", {
        configurable: false,
        enumerable: false,
        writable: true,
        value: false,
      }); // self and source are DEV only properties.

      Object.defineProperty(element, "_self", {
        configurable: false,
        enumerable: false,
        writable: false,
        value: self,
      }); // Two elements created in two different places should be considered
      // equal for testing purposes and therefore we hide it from enumeration.

      Object.defineProperty(element, "_source", {
        configurable: false,
        enumerable: false,
        writable: false,
        value: source,
      });

      if (Object.freeze) {
        Object.freeze(element.props);
        Object.freeze(element);
      }
    }

    return element;
  };
  /**
   * Create and return a new ReactElement of the given type.
   * See https://reactjs.org/docs/react-api.html#createelement
   */

  function createElement(type, config, children) {
    var propName; // Reserved names are extracted

    var props = {};
    var key = null;
    var ref = null;
    var self = null;
    var source = null;

    if (config != null) {
      if (hasValidRef(config)) {
        ref = config.ref;

        {
          warnIfStringRefCannotBeAutoConverted(config);
        }
      }

      if (hasValidKey(config)) {
        key = "" + config.key;
      }

      self = config.__self === undefined ? null : config.__self;
      source = config.__source === undefined ? null : config.__source; // Remaining properties are added to a new props object

      for (propName in config) {
        if (
          hasOwnProperty$1.call(config, propName) &&
          !RESERVED_PROPS.hasOwnProperty(propName)
        ) {
          props[propName] = config[propName];
        }
      }
    } // Children can be more than one argument, and those are transferred onto
    // the newly allocated props object.

    var childrenLength = arguments.length - 2;

    if (childrenLength === 1) {
      props.children = children;
    } else if (childrenLength > 1) {
      var childArray = Array(childrenLength);

      for (var i = 0; i < childrenLength; i++) {
        childArray[i] = arguments[i + 2];
      }

      {
        if (Object.freeze) {
          Object.freeze(childArray);
        }
      }

      props.children = childArray;
    } // Resolve default props

    if (type && type.defaultProps) {
      var defaultProps = type.defaultProps;

      for (propName in defaultProps) {
        if (props[propName] === undefined) {
          props[propName] = defaultProps[propName];
        }
      }
    }

    {
      if (key || ref) {
        var displayName =
          typeof type === "function"
            ? type.displayName || type.name || "Unknown"
            : type;

        if (key) {
          defineKeyPropWarningGetter(props, displayName);
        }

        if (ref) {
          defineRefPropWarningGetter(props, displayName);
        }
      }
    }

    return ReactElement(
      type,
      key,
      ref,
      self,
      source,
      ReactCurrentOwner.current,
      props,
    );
  }
  function cloneAndReplaceKey(oldElement, newKey) {
    var newElement = ReactElement(
      oldElement.type,
      newKey,
      oldElement.ref,
      oldElement._self,
      oldElement._source,
      oldElement._owner,
      oldElement.props,
    );
    return newElement;
  }
  /**
   * Clone and return a new ReactElement using element as the starting point.
   * See https://reactjs.org/docs/react-api.html#cloneelement
   */

  function cloneElement(element, config, children) {
    if (!!(element === null || element === undefined)) {
      {
        throw Error(
          "React.cloneElement(...): The argument must be a React element, but you passed " +
            element +
            ".",
        );
      }
    }

    var propName; // Original props are copied

    var props = assign({}, element.props); // Reserved names are extracted

    var key = element.key;
    var ref = element.ref; // Self is preserved since the owner is preserved.

    var self = element._self; // Source is preserved since cloneElement is unlikely to be targeted by a
    // transpiler, and the original source is probably a better indicator of the
    // true owner.

    var source = element._source; // Owner will be preserved, unless ref is overridden

    var owner = element._owner;

    if (config != null) {
      if (hasValidRef(config)) {
        // Silently steal the ref from the parent.
        ref = config.ref;
        owner = ReactCurrentOwner.current;
      }

      if (hasValidKey(config)) {
        key = "" + config.key;
      } // Remaining properties override existing props

      var defaultProps;

      if (element.type && element.type.defaultProps) {
        defaultProps = element.type.defaultProps;
      }

      for (propName in config) {
        if (
          hasOwnProperty$1.call(config, propName) &&
          !RESERVED_PROPS.hasOwnProperty(propName)
        ) {
          if (config[propName] === undefined && defaultProps !== undefined) {
            // Resolve default props
            props[propName] = defaultProps[propName];
          } else {
            props[propName] = config[propName];
          }
        }
      }
    } // Children can be more than one argument, and those are transferred onto
    // the newly allocated props object.

    var childrenLength = arguments.length - 2;

    if (childrenLength === 1) {
      props.children = children;
    } else if (childrenLength > 1) {
      var childArray = Array(childrenLength);

      for (var i = 0; i < childrenLength; i++) {
        childArray[i] = arguments[i + 2];
      }

      props.children = childArray;
    }

    return ReactElement(element.type, key, ref, self, source, owner, props);
  }
  /**
   * Verifies the object is a ReactElement.
   * See https://reactjs.org/docs/react-api.html#isvalidelement
   * @param {?object} object
   * @return {boolean} True if `object` is a ReactElement.
   * @final
   */

  function isValidElement(object) {
    return (
      typeof object === "object" &&
      object !== null &&
      object.$$typeof === REACT_ELEMENT_TYPE
    );
  }

  var SEPARATOR = ".";
  var SUBSEPARATOR = ":";
  /**
   * Escape and wrap key so it is safe to use as a reactid
   *
   * @param {string} key to be escaped.
   * @return {string} the escaped key.
   */

  function escape(key) {
    var escapeRegex = /[=:]/g;
    var escaperLookup = {
      "=": "=0",
      ":": "=2",
    };
    var escapedString = key.replace(escapeRegex, function (match) {
      return escaperLookup[match];
    });
    return "$" + escapedString;
  }
  /**
   * TODO: Test that a single child and an array with one item have the same key
   * pattern.
   */

  var didWarnAboutMaps = false;
  var userProvidedKeyEscapeRegex = /\/+/g;

  function escapeUserProvidedKey(text) {
    return text.replace(userProvidedKeyEscapeRegex, "$&/");
  }
  /**
   * Generate a key string that identifies a element within a set.
   *
   * @param {*} element A element that could contain a manual key.
   * @param {number} index Index that is used if a manual key is not provided.
   * @return {string}
   */

  function getElementKey(element, index) {
    // Do some typechecking here since we call this blindly. We want to ensure
    // that we don't block potential future ES APIs.
    if (
      typeof element === "object" &&
      element !== null &&
      element.key != null
    ) {
      // Explicit key
      return escape("" + element.key);
    } // Implicit key determined by the index in the set

    return index.toString(36);
  }

  function mapIntoArray(children, array, escapedPrefix, nameSoFar, callback) {
    var type = typeof children;

    if (type === "undefined" || type === "boolean") {
      // All of the above are perceived as null.
      children = null;
    }

    var invokeCallback = false;

    if (children === null) {
      invokeCallback = true;
    } else {
      switch (type) {
        case "string":
        case "number":
          invokeCallback = true;
          break;

        case "object":
          switch (children.$$typeof) {
            case REACT_ELEMENT_TYPE:
            case REACT_PORTAL_TYPE:
              invokeCallback = true;
          }
      }
    }

    if (invokeCallback) {
      var _child = children;
      var mappedChild = callback(_child); // If it's the only child, treat the name as if it was wrapped in an array
      // so that it's consistent if the number of children grows:

      var childKey =
        nameSoFar === "" ? SEPARATOR + getElementKey(_child, 0) : nameSoFar;

      if (Array.isArray(mappedChild)) {
        var escapedChildKey = "";

        if (childKey != null) {
          escapedChildKey = escapeUserProvidedKey(childKey) + "/";
        }

        mapIntoArray(mappedChild, array, escapedChildKey, "", function (c) {
          return c;
        });
      } else if (mappedChild != null) {
        if (isValidElement(mappedChild)) {
          mappedChild = cloneAndReplaceKey(
            mappedChild, // Keep both the (mapped) and old keys if they differ, just as
            // traverseAllChildren used to do for objects as children
            escapedPrefix + // $FlowFixMe Flow incorrectly thinks React.Portal doesn't have a key
              (mappedChild.key && (!_child || _child.key !== mappedChild.key) // $FlowFixMe Flow incorrectly thinks existing element's key can be a number
                ? escapeUserProvidedKey("" + mappedChild.key) + "/"
                : "") +
              childKey,
          );
        }

        array.push(mappedChild);
      }

      return 1;
    }

    var child;
    var nextName;
    var subtreeCount = 0; // Count of children found in the current subtree.

    var nextNamePrefix =
      nameSoFar === "" ? SEPARATOR : nameSoFar + SUBSEPARATOR;

    if (Array.isArray(children)) {
      for (var i = 0; i < children.length; i++) {
        child = children[i];
        nextName = nextNamePrefix + getElementKey(child, i);
        subtreeCount += mapIntoArray(
          child,
          array,
          escapedPrefix,
          nextName,
          callback,
        );
      }
    } else {
      var iteratorFn = getIteratorFn(children);

      if (typeof iteratorFn === "function") {
        var iterableChildren = children;

        {
          // Warn about using Maps as children
          if (iteratorFn === iterableChildren.entries) {
            if (!didWarnAboutMaps) {
              warn(
                "Using Maps as children is not supported. " +
                  "Use an array of keyed ReactElements instead.",
              );
            }

            didWarnAboutMaps = true;
          }
        }

        var iterator = iteratorFn.call(iterableChildren);
        var step;
        var ii = 0;

        while (!(step = iterator.next()).done) {
          child = step.value;
          nextName = nextNamePrefix + getElementKey(child, ii++);
          subtreeCount += mapIntoArray(
            child,
            array,
            escapedPrefix,
            nextName,
            callback,
          );
        }
      } else if (type === "object") {
        var childrenString = "" + children;

        {
          {
            throw Error(
              "Objects are not valid as a React child (found: " +
                (childrenString === "[object Object]"
                  ? "object with keys {" +
                    Object.keys(children).join(", ") +
                    "}"
                  : childrenString) +
                "). If you meant to render a collection of children, use an array instead.",
            );
          }
        }
      }
    }

    return subtreeCount;
  }

  /**
   * Maps children that are typically specified as `props.children`.
   *
   * See https://reactjs.org/docs/react-api.html#reactchildrenmap
   *
   * The provided mapFunction(child, index) will be called for each
   * leaf child.
   *
   * @param {?*} children Children tree container.
   * @param {function(*, int)} func The map function.
   * @param {*} context Context for mapFunction.
   * @return {object} Object containing the ordered map of results.
   */
  function mapChildren(children, func, context) {
    if (children == null) {
      return children;
    }

    var result = [];
    var count = 0;
    mapIntoArray(children, result, "", "", function (child) {
      return func.call(context, child, count++);
    });
    return result;
  }
  /**
   * Count the number of children that are typically specified as
   * `props.children`.
   *
   * See https://reactjs.org/docs/react-api.html#reactchildrencount
   *
   * @param {?*} children Children tree container.
   * @return {number} The number of children.
   */

  function countChildren(children) {
    var n = 0;
    mapChildren(children, function () {
      n++; // Don't return anything
    });
    return n;
  }

  /**
   * Iterates through children that are typically specified as `props.children`.
   *
   * See https://reactjs.org/docs/react-api.html#reactchildrenforeach
   *
   * The provided forEachFunc(child, index) will be called for each
   * leaf child.
   *
   * @param {?*} children Children tree container.
   * @param {function(*, int)} forEachFunc
   * @param {*} forEachContext Context for forEachContext.
   */
  function forEachChildren(children, forEachFunc, forEachContext) {
    mapChildren(
      children,
      function () {
        forEachFunc.apply(this, arguments); // Don't return anything.
      },
      forEachContext,
    );
  }
  /**
   * Flatten a children object (typically specified as `props.children`) and
   * return an array with appropriately re-keyed children.
   *
   * See https://reactjs.org/docs/react-api.html#reactchildrentoarray
   */

  function toArray(children) {
    return (
      mapChildren(children, function (child) {
        return child;
      }) || []
    );
  }
  /**
   * Returns the first child in a collection of children and verifies that there
   * is only one child in the collection.
   *
   * See https://reactjs.org/docs/react-api.html#reactchildrenonly
   *
   * The current implementation of this function assumes that a single child gets
   * passed without a wrapper, but the purpose of this helper function is to
   * abstract away the particular structure of children.
   *
   * @param {?object} children Child collection structure.
   * @return {ReactElement} The first and only `ReactElement` contained in the
   * structure.
   */

  function onlyChild(children) {
    if (!isValidElement(children)) {
      {
        throw Error(
          "React.Children.only expected to receive a single React element child.",
        );
      }
    }

    return children;
  }

  function createContext(defaultValue, calculateChangedBits) {
    if (calculateChangedBits === undefined) {
      calculateChangedBits = null;
    } else {
      {
        if (
          calculateChangedBits !== null &&
          typeof calculateChangedBits !== "function"
        ) {
          error(
            "createContext: Expected the optional second argument to be a " +
              "function. Instead received: %s",
            calculateChangedBits,
          );
        }
      }
    }

    var context = {
      $$typeof: REACT_CONTEXT_TYPE,
      _calculateChangedBits: calculateChangedBits,
      // As a workaround to support multiple concurrent renderers, we categorize
      // some renderers as primary and others as secondary. We only expect
      // there to be two concurrent renderers at most: React Native (primary) and
      // Fabric (secondary); React DOM (primary) and React ART (secondary).
      // Secondary renderers store their context values on separate fields.
      _currentValue: defaultValue,
      _currentValue2: defaultValue,
      // Used to track how many concurrent renderers this context currently
      // supports within in a single renderer. Such as parallel server rendering.
      _threadCount: 0,
      // These are circular
      Provider: null,
      Consumer: null,
    };
    context.Provider = {
      $$typeof: REACT_PROVIDER_TYPE,
      _context: context,
    };
    var hasWarnedAboutUsingNestedContextConsumers = false;
    var hasWarnedAboutUsingConsumerProvider = false;
    var hasWarnedAboutDisplayNameOnConsumer = false;

    {
      // A separate object, but proxies back to the original context object for
      // backwards compatibility. It has a different $$typeof, so we can properly
      // warn for the incorrect usage of Context as a Consumer.
      var Consumer = {
        $$typeof: REACT_CONTEXT_TYPE,
        _context: context,
        _calculateChangedBits: context._calculateChangedBits,
      }; // $FlowFixMe: Flow complains about not setting a value, which is intentional here

      Object.defineProperties(Consumer, {
        Provider: {
          get: function () {
            if (!hasWarnedAboutUsingConsumerProvider) {
              hasWarnedAboutUsingConsumerProvider = true;

              error(
                "Rendering <Context.Consumer.Provider> is not supported and will be removed in " +
                  "a future major release. Did you mean to render <Context.Provider> instead?",
              );
            }

            return context.Provider;
          },
          set: function (_Provider) {
            context.Provider = _Provider;
          },
        },
        _currentValue: {
          get: function () {
            return context._currentValue;
          },
          set: function (_currentValue) {
            context._currentValue = _currentValue;
          },
        },
        _currentValue2: {
          get: function () {
            return context._currentValue2;
          },
          set: function (_currentValue2) {
            context._currentValue2 = _currentValue2;
          },
        },
        _threadCount: {
          get: function () {
            return context._threadCount;
          },
          set: function (_threadCount) {
            context._threadCount = _threadCount;
          },
        },
        Consumer: {
          get: function () {
            if (!hasWarnedAboutUsingNestedContextConsumers) {
              hasWarnedAboutUsingNestedContextConsumers = true;

              error(
                "Rendering <Context.Consumer.Consumer> is not supported and will be removed in " +
                  "a future major release. Did you mean to render <Context.Consumer> instead?",
              );
            }

            return context.Consumer;
          },
        },
        displayName: {
          get: function () {
            return context.displayName;
          },
          set: function (displayName) {
            if (!hasWarnedAboutDisplayNameOnConsumer) {
              warn(
                "Setting `displayName` on Context.Consumer has no effect. " +
                  "You should set it directly on the context with Context.displayName = '%s'.",
                displayName,
              );

              hasWarnedAboutDisplayNameOnConsumer = true;
            }
          },
        },
      }); // $FlowFixMe: Flow complains about missing properties because it doesn't understand defineProperty

      context.Consumer = Consumer;
    }

    {
      context._currentRenderer = null;
      context._currentRenderer2 = null;
    }

    return context;
  }

  var Uninitialized = -1;
  var Pending = 0;
  var Resolved = 1;
  var Rejected = 2;

  function lazyInitializer(payload) {
    if (payload._status === Uninitialized) {
      var ctor = payload._result;
      var thenable = ctor(); // Transition to the next state.

      var pending = payload;
      pending._status = Pending;
      pending._result = thenable;
      thenable.then(
        function (moduleObject) {
          if (payload._status === Pending) {
            var defaultExport = moduleObject.default;

            {
              if (defaultExport === undefined) {
                error(
                  "lazy: Expected the result of a dynamic import() call. " +
                    "Instead received: %s\n\nYour code should look like: \n  " + // Break up imports to avoid accidentally parsing them as dependencies.
                    "const MyComponent = lazy(() => imp" +
                    "ort('./MyComponent'))",
                  moduleObject,
                );
              }
            } // Transition to the next state.

            var resolved = payload;
            resolved._status = Resolved;
            resolved._result = defaultExport;
          }
        },
        function (error) {
          if (payload._status === Pending) {
            // Transition to the next state.
            var rejected = payload;
            rejected._status = Rejected;
            rejected._result = error;
          }
        },
      );
    }

    if (payload._status === Resolved) {
      return payload._result;
    } else {
      throw payload._result;
    }
  }

  function lazy(ctor) {
    var payload = {
      // We use these fields to store the result.
      _status: -1,
      _result: ctor,
    };
    var lazyType = {
      $$typeof: REACT_LAZY_TYPE,
      _payload: payload,
      _init: lazyInitializer,
    };

    {
      // In production, this would just set it on the object.
      var defaultProps;
      var propTypes; // $FlowFixMe

      Object.defineProperties(lazyType, {
        defaultProps: {
          configurable: true,
          get: function () {
            return defaultProps;
          },
          set: function (newDefaultProps) {
            error(
              "React.lazy(...): It is not supported to assign `defaultProps` to " +
                "a lazy component import. Either specify them where the component " +
                "is defined, or create a wrapping component around it.",
            );

            defaultProps = newDefaultProps; // Match production behavior more closely:
            // $FlowFixMe

            Object.defineProperty(lazyType, "defaultProps", {
              enumerable: true,
            });
          },
        },
        propTypes: {
          configurable: true,
          get: function () {
            return propTypes;
          },
          set: function (newPropTypes) {
            error(
              "React.lazy(...): It is not supported to assign `propTypes` to " +
                "a lazy component import. Either specify them where the component " +
                "is defined, or create a wrapping component around it.",
            );

            propTypes = newPropTypes; // Match production behavior more closely:
            // $FlowFixMe

            Object.defineProperty(lazyType, "propTypes", {
              enumerable: true,
            });
          },
        },
      });
    }

    return lazyType;
  }

  function forwardRef(render) {
    {
      if (render != null && render.$$typeof === REACT_MEMO_TYPE) {
        error(
          "forwardRef requires a render function but received a `memo` " +
            "component. Instead of forwardRef(memo(...)), use " +
            "memo(forwardRef(...)).",
        );
      } else if (typeof render !== "function") {
        error(
          "forwardRef requires a render function but was given %s.",
          render === null ? "null" : typeof render,
        );
      } else {
        if (render.length !== 0 && render.length !== 2) {
          error(
            "forwardRef render functions accept exactly two parameters: props and ref. %s",
            render.length === 1
              ? "Did you forget to use the ref parameter?"
              : "Any additional parameter will be undefined.",
          );
        }
      }

      if (render != null) {
        if (render.defaultProps != null || render.propTypes != null) {
          error(
            "forwardRef render functions do not support propTypes or defaultProps. " +
              "Did you accidentally pass a React component?",
          );
        }
      }
    }

    var elementType = {
      $$typeof: REACT_FORWARD_REF_TYPE,
      render: render,
    };

    {
      var ownName;
      Object.defineProperty(elementType, "displayName", {
        enumerable: false,
        configurable: true,
        get: function () {
          return ownName;
        },
        set: function (name) {
          ownName = name;

          if (render.displayName == null) {
            render.displayName = name;
          }
        },
      });
    }

    return elementType;
  }

  // Filter certain DOM attributes (e.g. src, href) if their values are empty strings.

  var enableScopeAPI = false; // Experimental Create Event Handle API.

  function isValidElementType(type) {
    if (typeof type === "string" || typeof type === "function") {
      return true;
    } // Note: typeof might be other than 'symbol' or 'number' (e.g. if it's a polyfill).

    if (
      type === exports.Fragment ||
      type === exports.Profiler ||
      type === REACT_DEBUG_TRACING_MODE_TYPE ||
      type === exports.StrictMode ||
      type === exports.Suspense ||
      type === REACT_SUSPENSE_LIST_TYPE ||
      type === REACT_LEGACY_HIDDEN_TYPE ||
      enableScopeAPI
    ) {
      return true;
    }

    if (typeof type === "object" && type !== null) {
      if (
        type.$$typeof === REACT_LAZY_TYPE ||
        type.$$typeof === REACT_MEMO_TYPE ||
        type.$$typeof === REACT_PROVIDER_TYPE ||
        type.$$typeof === REACT_CONTEXT_TYPE ||
        type.$$typeof === REACT_FORWARD_REF_TYPE ||
        type.$$typeof === REACT_FUNDAMENTAL_TYPE ||
        type.$$typeof === REACT_BLOCK_TYPE ||
        type[0] === REACT_SERVER_BLOCK_TYPE
      ) {
        return true;
      }
    }

    return false;
  }

  function memo(type, compare) {
    {
      if (!isValidElementType(type)) {
        error(
          "memo: The first argument must be a component. Instead " +
            "received: %s",
          type === null ? "null" : typeof type,
        );
      }
    }

    var elementType = {
      $$typeof: REACT_MEMO_TYPE,
      type: type,
      compare: compare === undefined ? null : compare,
    };

    {
      var ownName;
      Object.defineProperty(elementType, "displayName", {
        enumerable: false,
        configurable: true,
        get: function () {
          return ownName;
        },
        set: function (name) {
          ownName = name;

          if (type.displayName == null) {
            type.displayName = name;
          }
        },
      });
    }

    return elementType;
  }

  function resolveDispatcher() {
    var dispatcher = ReactCurrentDispatcher.current;

    if (!(dispatcher !== null)) {
      {
        throw Error(
          "Invalid hook call. Hooks can only be called inside of the body of a function component. This could happen for one of the following reasons:\n1. You might have mismatching versions of React and the renderer (such as React DOM)\n2. You might be breaking the Rules of Hooks\n3. You might have more than one copy of React in the same app\nSee https://reactjs.org/link/invalid-hook-call for tips about how to debug and fix this problem.",
        );
      }
    }

    return dispatcher;
  }

  function useContext(Context, unstable_observedBits) {
    var dispatcher = resolveDispatcher();

    {
      if (unstable_observedBits !== undefined) {
        error(
          "useContext() second argument is reserved for future " +
            "use in React. Passing it is not supported. " +
            "You passed: %s.%s",
          unstable_observedBits,
          typeof unstable_observedBits === "number" &&
            Array.isArray(arguments[2])
            ? "\n\nDid you call array.map(useContext)? " +
                "Calling Hooks inside a loop is not supported. " +
                "Learn more at https://reactjs.org/link/rules-of-hooks"
            : "",
        );
      } // TODO: add a more generic warning for invalid values.

      if (Context._context !== undefined) {
        var realContext = Context._context; // Don't deduplicate because this legitimately causes bugs
        // and nobody should be using this in existing code.

        if (realContext.Consumer === Context) {
          error(
            "Calling useContext(Context.Consumer) is not supported, may cause bugs, and will be " +
              "removed in a future major release. Did you mean to call useContext(Context) instead?",
          );
        } else if (realContext.Provider === Context) {
          error(
            "Calling useContext(Context.Provider) is not supported. " +
              "Did you mean to call useContext(Context) instead?",
          );
        }
      }
    }

    return dispatcher.useContext(Context, unstable_observedBits);
  }
  function useState(initialState) {
    var dispatcher = resolveDispatcher();
    return dispatcher.useState(initialState);
  }
  function useReducer(reducer, initialArg, init) {
    var dispatcher = resolveDispatcher();
    return dispatcher.useReducer(reducer, initialArg, init);
  }
  function useRef(initialValue) {
    var dispatcher = resolveDispatcher();
    return dispatcher.useRef(initialValue);
  }
  function useEffect(create, deps) {
    var dispatcher = resolveDispatcher();
    return dispatcher.useEffect(create, deps);
  }
  function useLayoutEffect(create, deps) {
    var dispatcher = resolveDispatcher();
    return dispatcher.useLayoutEffect(create, deps);
  }
  function useCallback(callback, deps) {
    var dispatcher = resolveDispatcher();
    return dispatcher.useCallback(callback, deps);
  }
  function useMemo(create, deps) {
    var dispatcher = resolveDispatcher();
    return dispatcher.useMemo(create, deps);
  }
  function useImperativeHandle(ref, create, deps) {
    var dispatcher = resolveDispatcher();
    return dispatcher.useImperativeHandle(ref, create, deps);
  }
  function useDebugValue(value, formatterFn) {
    {
      var dispatcher = resolveDispatcher();
      return dispatcher.useDebugValue(value, formatterFn);
    }
  }

  // Helpers to patch console.logs to avoid logging during side-effect free
  // replaying on render function. This currently only patches the object
  // lazily which won't cover if the log function was extracted eagerly.
  // We could also eagerly patch the method.
  var disabledDepth = 0;
  var prevLog;
  var prevInfo;
  var prevWarn;
  var prevError;
  var prevGroup;
  var prevGroupCollapsed;
  var prevGroupEnd;

  function disabledLog() {}

  disabledLog.__reactDisabledLog = true;
  function disableLogs() {
    {
      if (disabledDepth === 0) {
        /* eslint-disable react-internal/no-production-logging */
        prevLog = console.log;
        prevInfo = console.info;
        prevWarn = console.warn;
        prevError = console.error;
        prevGroup = console.group;
        prevGroupCollapsed = console.groupCollapsed;
        prevGroupEnd = console.groupEnd; // https://github.com/facebook/react/issues/19099

        var props = {
          configurable: true,
          enumerable: true,
          value: disabledLog,
          writable: true,
        }; // $FlowFixMe Flow thinks console is immutable.

        Object.defineProperties(console, {
          info: props,
          log: props,
          warn: props,
          error: props,
          group: props,
          groupCollapsed: props,
          groupEnd: props,
        });
        /* eslint-enable react-internal/no-production-logging */
      }

      disabledDepth++;
    }
  }
  function reenableLogs() {
    {
      disabledDepth--;

      if (disabledDepth === 0) {
        /* eslint-disable react-internal/no-production-logging */
        var props = {
          configurable: true,
          enumerable: true,
          writable: true,
        }; // $FlowFixMe Flow thinks console is immutable.

        Object.defineProperties(console, {
          log: assign({}, props, {
            value: prevLog,
          }),
          info: assign({}, props, {
            value: prevInfo,
          }),
          warn: assign({}, props, {
            value: prevWarn,
          }),
          error: assign({}, props, {
            value: prevError,
          }),
          group: assign({}, props, {
            value: prevGroup,
          }),
          groupCollapsed: assign({}, props, {
            value: prevGroupCollapsed,
          }),
          groupEnd: assign({}, props, {
            value: prevGroupEnd,
          }),
        });
        /* eslint-enable react-internal/no-production-logging */
      }

      if (disabledDepth < 0) {
        error(
          "disabledDepth fell below zero. " +
            "This is a bug in React. Please file an issue.",
        );
      }
    }
  }

  var ReactCurrentDispatcher$1 = ReactSharedInternals.ReactCurrentDispatcher;
  var prefix;
  function describeBuiltInComponentFrame(name, source, ownerFn) {
    {
      if (prefix === undefined) {
        // Extract the VM specific prefix used by each line.
        try {
          throw Error();
        } catch (x) {
          var match = x.stack.trim().match(/\n( *(at )?)/);
          prefix = (match && match[1]) || "";
        }
      } // We use the prefix to ensure our stacks line up with native stack frames.

      return "\n" + prefix + name;
    }
  }
  var reentry = false;
  var componentFrameCache;

  {
    var PossiblyWeakMap = typeof WeakMap === "function" ? WeakMap : Map;
    componentFrameCache = new PossiblyWeakMap();
  }

  function describeNativeComponentFrame(fn, construct) {
    // If something asked for a stack inside a fake render, it should get ignored.
    if (!fn || reentry) {
      return "";
    }

    {
      var frame = componentFrameCache.get(fn);

      if (frame !== undefined) {
        return frame;
      }
    }

    var control;
    reentry = true;
    var previousPrepareStackTrace = Error.prepareStackTrace; // $FlowFixMe It does accept undefined.

    Error.prepareStackTrace = undefined;
    var previousDispatcher;

    {
      previousDispatcher = ReactCurrentDispatcher$1.current; // Set the dispatcher in DEV because this might be call in the render function
      // for warnings.

      ReactCurrentDispatcher$1.current = null;
      disableLogs();
    }

    try {
      // This should throw.
      if (construct) {
        // Something should be setting the props in the constructor.
        var Fake = function () {
          throw Error();
        }; // $FlowFixMe

        Object.defineProperty(Fake.prototype, "props", {
          set: function () {
            // We use a throwing setter instead of frozen or non-writable props
            // because that won't throw in a non-strict mode function.
            throw Error();
          },
        });

        if (typeof Reflect === "object" && Reflect.construct) {
          // We construct a different control for this case to include any extra
          // frames added by the construct call.
          try {
            Reflect.construct(Fake, []);
          } catch (x) {
            control = x;
          }

          Reflect.construct(fn, [], Fake);
        } else {
          try {
            Fake.call();
          } catch (x) {
            control = x;
          }

          fn.call(Fake.prototype);
        }
      } else {
        try {
          throw Error();
        } catch (x) {
          control = x;
        }

        fn();
      }
    } catch (sample) {
      // This is inlined manually because closure doesn't do it for us.
      if (sample && control && typeof sample.stack === "string") {
        // This extracts the first frame from the sample that isn't also in the control.
        // Skipping one frame that we assume is the frame that calls the two.
        var sampleLines = sample.stack.split("\n");
        var controlLines = control.stack.split("\n");
        var s = sampleLines.length - 1;
        var c = controlLines.length - 1;

        while (s >= 1 && c >= 0 && sampleLines[s] !== controlLines[c]) {
          // We expect at least one stack frame to be shared.
          // Typically this will be the root most one. However, stack frames may be
          // cut off due to maximum stack limits. In this case, one maybe cut off
          // earlier than the other. We assume that the sample is longer or the same
          // and there for cut off earlier. So we should find the root most frame in
          // the sample somewhere in the control.
          c--;
        }

        for (; s >= 1 && c >= 0; s--, c--) {
          // Next we find the first one that isn't the same which should be the
          // frame that called our sample function and the control.
          if (sampleLines[s] !== controlLines[c]) {
            // In V8, the first line is describing the message but other VMs don't.
            // If we're about to return the first line, and the control is also on the same
            // line, that's a pretty good indicator that our sample threw at same line as
            // the control. I.e. before we entered the sample frame. So we ignore this result.
            // This can happen if you passed a class to function component, or non-function.
            if (s !== 1 || c !== 1) {
              do {
                s--;
                c--; // We may still have similar intermediate frames from the construct call.
                // The next one that isn't the same should be our match though.

                if (c < 0 || sampleLines[s] !== controlLines[c]) {
                  // V8 adds a "new" prefix for native classes. Let's remove it to make it prettier.
                  var _frame =
                    "\n" + sampleLines[s].replace(" at new ", " at ");

                  {
                    if (typeof fn === "function") {
                      componentFrameCache.set(fn, _frame);
                    }
                  } // Return the line we found.

                  return _frame;
                }
              } while (s >= 1 && c >= 0);
            }

            break;
          }
        }
      }
    } finally {
      reentry = false;

      {
        ReactCurrentDispatcher$1.current = previousDispatcher;
        reenableLogs();
      }

      Error.prepareStackTrace = previousPrepareStackTrace;
    } // Fallback to just using the name if we couldn't make it throw.

    var name = fn ? fn.displayName || fn.name : "";
    var syntheticFrame = name ? describeBuiltInComponentFrame(name) : "";

    {
      if (typeof fn === "function") {
        componentFrameCache.set(fn, syntheticFrame);
      }
    }

    return syntheticFrame;
  }
  function describeFunctionComponentFrame(fn, source, ownerFn) {
    {
      return describeNativeComponentFrame(fn, false);
    }
  }

  function shouldConstruct(Component) {
    var prototype = Component.prototype;
    return !!(prototype && prototype.isReactComponent);
  }

  function describeUnknownElementTypeFrameInDEV(type, source, ownerFn) {
    if (type == null) {
      return "";
    }

    if (typeof type === "function") {
      {
        return describeNativeComponentFrame(type, shouldConstruct(type));
      }
    }

    if (typeof type === "string") {
      return describeBuiltInComponentFrame(type);
    }

    switch (type) {
      case exports.Suspense:
        return describeBuiltInComponentFrame("Suspense");

      case REACT_SUSPENSE_LIST_TYPE:
        return describeBuiltInComponentFrame("SuspenseList");
    }

    if (typeof type === "object") {
      switch (type.$$typeof) {
        case REACT_FORWARD_REF_TYPE:
          return describeFunctionComponentFrame(type.render);

        case REACT_MEMO_TYPE:
          // Memo may contain any component type so we recursively resolve it.
          return describeUnknownElementTypeFrameInDEV(
            type.type,
            source,
            ownerFn,
          );

        case REACT_BLOCK_TYPE:
          return describeFunctionComponentFrame(type._render);

        case REACT_LAZY_TYPE: {
          var lazyComponent = type;
          var payload = lazyComponent._payload;
          var init = lazyComponent._init;

          try {
            // Lazy may contain any component type so we recursively resolve it.
            return describeUnknownElementTypeFrameInDEV(
              init(payload),
              source,
              ownerFn,
            );
          } catch (x) {}
        }
      }
    }

    return "";
  }

  var loggedTypeFailures = {};
  var ReactDebugCurrentFrame$1 = ReactSharedInternals.ReactDebugCurrentFrame;

  function setCurrentlyValidatingElement(element) {
    {
      if (element) {
        var owner = element._owner;
        var stack = describeUnknownElementTypeFrameInDEV(
          element.type,
          element._source,
          owner ? owner.type : null,
        );
        ReactDebugCurrentFrame$1.setExtraStackFrame(stack);
      } else {
        ReactDebugCurrentFrame$1.setExtraStackFrame(null);
      }
    }
  }

  function checkPropTypes(typeSpecs, values, location, componentName, element) {
    {
      // $FlowFixMe This is okay but Flow doesn't know it.
      var has = Function.call.bind(Object.prototype.hasOwnProperty);

      for (var typeSpecName in typeSpecs) {
        if (has(typeSpecs, typeSpecName)) {
          var error$1 = void 0; // Prop type validation may throw. In case they do, we don't want to
          // fail the render phase where it didn't fail before. So we log it.
          // After these have been cleaned up, we'll let them throw.

          try {
            // This is intentionally an invariant that gets caught. It's the same
            // behavior as without this statement except with a better message.
            if (typeof typeSpecs[typeSpecName] !== "function") {
              var err = Error(
                (componentName || "React class") +
                  ": " +
                  location +
                  " type `" +
                  typeSpecName +
                  "` is invalid; " +
                  "it must be a function, usually from the `prop-types` package, but received `" +
                  typeof typeSpecs[typeSpecName] +
                  "`." +
                  "This often happens because of typos such as `PropTypes.function` instead of `PropTypes.func`.",
              );
              err.name = "Invariant Violation";
              throw err;
            }

            error$1 = typeSpecs[typeSpecName](
              values,
              typeSpecName,
              componentName,
              location,
              null,
              "SECRET_DO_NOT_PASS_THIS_OR_YOU_WILL_BE_FIRED",
            );
          } catch (ex) {
            error$1 = ex;
          }

          if (error$1 && !(error$1 instanceof Error)) {
            setCurrentlyValidatingElement(element);

            error(
              "%s: type specification of %s" +
                " `%s` is invalid; the type checker " +
                "function must return `null` or an `Error` but returned a %s. " +
                "You may have forgotten to pass an argument to the type checker " +
                "creator (arrayOf, instanceOf, objectOf, oneOf, oneOfType, and " +
                "shape all require an argument).",
              componentName || "React class",
              location,
              typeSpecName,
              typeof error$1,
            );

            setCurrentlyValidatingElement(null);
          }

          if (
            error$1 instanceof Error &&
            !(error$1.message in loggedTypeFailures)
          ) {
            // Only monitor this failure once because there tends to be a lot of the
            // same error.
            loggedTypeFailures[error$1.message] = true;
            setCurrentlyValidatingElement(element);

            error("Failed %s type: %s", location, error$1.message);

            setCurrentlyValidatingElement(null);
          }
        }
      }
    }
  }

  function setCurrentlyValidatingElement$1(element) {
    {
      if (element) {
        var owner = element._owner;
        var stack = describeUnknownElementTypeFrameInDEV(
          element.type,
          element._source,
          owner ? owner.type : null,
        );
        setExtraStackFrame(stack);
      } else {
        setExtraStackFrame(null);
      }
    }
  }

  var propTypesMisspellWarningShown;

  {
    propTypesMisspellWarningShown = false;
  }

  function getDeclarationErrorAddendum() {
    if (ReactCurrentOwner.current) {
      var name = getComponentName(ReactCurrentOwner.current.type);

      if (name) {
        return "\n\nCheck the render method of `" + name + "`.";
      }
    }

    return "";
  }

  function getSourceInfoErrorAddendum(source) {
    if (source !== undefined) {
      var fileName = source.fileName.replace(/^.*[\\\/]/, "");
      var lineNumber = source.lineNumber;
      return "\n\nCheck your code at " + fileName + ":" + lineNumber + ".";
    }

    return "";
  }

  function getSourceInfoErrorAddendumForProps(elementProps) {
    if (elementProps !== null && elementProps !== undefined) {
      return getSourceInfoErrorAddendum(elementProps.__source);
    }

    return "";
  }
  /**
   * Warn if there's no key explicitly set on dynamic arrays of children or
   * object keys are not valid. This allows us to keep track of children between
   * updates.
   */

  var ownerHasKeyUseWarning = {};

  function getCurrentComponentErrorInfo(parentType) {
    var info = getDeclarationErrorAddendum();

    if (!info) {
      var parentName =
        typeof parentType === "string"
          ? parentType
          : parentType.displayName || parentType.name;

      if (parentName) {
        info =
          "\n\nCheck the top-level render call using <" + parentName + ">.";
      }
    }

    return info;
  }
  /**
   * Warn if the element doesn't have an explicit key assigned to it.
   * This element is in an array. The array could grow and shrink or be
   * reordered. All children that haven't already been validated are required to
   * have a "key" property assigned to it. Error statuses are cached so a warning
   * will only be shown once.
   *
   * @internal
   * @param {ReactElement} element Element that requires a key.
   * @param {*} parentType element's parent's type.
   */

  function validateExplicitKey(element, parentType) {
    if (!element._store || element._store.validated || element.key != null) {
      return;
    }

    element._store.validated = true;
    var currentComponentErrorInfo = getCurrentComponentErrorInfo(parentType);

    if (ownerHasKeyUseWarning[currentComponentErrorInfo]) {
      return;
    }

    ownerHasKeyUseWarning[currentComponentErrorInfo] = true; // Usually the current owner is the offender, but if it accepts children as a
    // property, it may be the creator of the child that's responsible for
    // assigning it a key.

    var childOwner = "";

    if (
      element &&
      element._owner &&
      element._owner !== ReactCurrentOwner.current
    ) {
      // Give the component that originally created this child.
      childOwner =
        " It was passed a child from " +
        getComponentName(element._owner.type) +
        ".";
    }

    {
      setCurrentlyValidatingElement$1(element);

      error(
        'Each child in a list should have a unique "key" prop.' +
          "%s%s See https://reactjs.org/link/warning-keys for more information.",
        currentComponentErrorInfo,
        childOwner,
      );

      setCurrentlyValidatingElement$1(null);
    }
  }
  /**
   * Ensure that every element either is passed in a static location, in an
   * array with an explicit keys property defined, or in an object literal
   * with valid key property.
   *
   * @internal
   * @param {ReactNode} node Statically passed child of any type.
   * @param {*} parentType node's parent's type.
   */

  function validateChildKeys(node, parentType) {
    if (typeof node !== "object") {
      return;
    }

    if (Array.isArray(node)) {
      for (var i = 0; i < node.length; i++) {
        var child = node[i];

        if (isValidElement(child)) {
          validateExplicitKey(child, parentType);
        }
      }
    } else if (isValidElement(node)) {
      // This element was passed in a valid location.
      if (node._store) {
        node._store.validated = true;
      }
    } else if (node) {
      var iteratorFn = getIteratorFn(node);

      if (typeof iteratorFn === "function") {
        // Entry iterators used to provide implicit keys,
        // but now we print a separate warning for them later.
        if (iteratorFn !== node.entries) {
          var iterator = iteratorFn.call(node);
          var step;

          while (!(step = iterator.next()).done) {
            if (isValidElement(step.value)) {
              validateExplicitKey(step.value, parentType);
            }
          }
        }
      }
    }
  }
  /**
   * Given an element, validate that its props follow the propTypes definition,
   * provided by the type.
   *
   * @param {ReactElement} element
   */

  function validatePropTypes(element) {
    {
      var type = element.type;

      if (type === null || type === undefined || typeof type === "string") {
        return;
      }

      var propTypes;

      if (typeof type === "function") {
        propTypes = type.propTypes;
      } else if (
        typeof type === "object" &&
        (type.$$typeof === REACT_FORWARD_REF_TYPE || // Note: Memo only checks outer props here.
          // Inner props are checked in the reconciler.
          type.$$typeof === REACT_MEMO_TYPE)
      ) {
        propTypes = type.propTypes;
      } else {
        return;
      }

      if (propTypes) {
        // Intentionally inside to avoid triggering lazy initializers:
        var name = getComponentName(type);
        checkPropTypes(propTypes, element.props, "prop", name, element);
      } else if (
        type.PropTypes !== undefined &&
        !propTypesMisspellWarningShown
      ) {
        propTypesMisspellWarningShown = true; // Intentionally inside to avoid triggering lazy initializers:

        var _name = getComponentName(type);

        error(
          "Component %s declared `PropTypes` instead of `propTypes`. Did you misspell the property assignment?",
          _name || "Unknown",
        );
      }

      if (
        typeof type.getDefaultProps === "function" &&
        !type.getDefaultProps.isReactClassApproved
      ) {
        error(
          "getDefaultProps is only used on classic React.createClass " +
            "definitions. Use a static property named `defaultProps` instead.",
        );
      }
    }
  }
  /**
   * Given a fragment, validate that it can only be provided with fragment props
   * @param {ReactElement} fragment
   */

  function validateFragmentProps(fragment) {
    {
      var keys = Object.keys(fragment.props);

      for (var i = 0; i < keys.length; i++) {
        var key = keys[i];

        if (key !== "children" && key !== "key") {
          setCurrentlyValidatingElement$1(fragment);

          error(
            "Invalid prop `%s` supplied to `React.Fragment`. " +
              "React.Fragment can only have `key` and `children` props.",
            key,
          );

          setCurrentlyValidatingElement$1(null);
          break;
        }
      }

      if (fragment.ref !== null) {
        setCurrentlyValidatingElement$1(fragment);

        error("Invalid attribute `ref` supplied to `React.Fragment`.");

        setCurrentlyValidatingElement$1(null);
      }
    }
  }
  function createElementWithValidation(type, props, children) {
    var validType = isValidElementType(type); // We warn in this case but don't throw. We expect the element creation to
    // succeed and there will likely be errors in render.

    if (!validType) {
      var info = "";

      if (
        type === undefined ||
        (typeof type === "object" &&
          type !== null &&
          Object.keys(type).length === 0)
      ) {
        info +=
          " You likely forgot to export your component from the file " +
          "it's defined in, or you might have mixed up default and named imports.";
      }

      var sourceInfo = getSourceInfoErrorAddendumForProps(props);

      if (sourceInfo) {
        info += sourceInfo;
      } else {
        info += getDeclarationErrorAddendum();
      }

      var typeString;

      if (type === null) {
        typeString = "null";
      } else if (Array.isArray(type)) {
        typeString = "array";
      } else if (type !== undefined && type.$$typeof === REACT_ELEMENT_TYPE) {
        typeString = "<" + (getComponentName(type.type) || "Unknown") + " />";
        info =
          " Did you accidentally export a JSX literal instead of a component?";
      } else {
        typeString = typeof type;
      }

      {
        error(
          "React.createElement: type is invalid -- expected a string (for " +
            "built-in components) or a class/function (for composite " +
            "components) but got: %s.%s",
          typeString,
          info,
        );
      }
    }

    var element = createElement.apply(this, arguments); // The result can be nullish if a mock or a custom function is used.
    // TODO: Drop this when these are no longer allowed as the type argument.

    if (element == null) {
      return element;
    } // Skip key warning if the type isn't valid since our key validation logic
    // doesn't expect a non-string/function type and can throw confusing errors.
    // We don't want exception behavior to differ between dev and prod.
    // (Rendering will throw with a helpful message and as soon as the type is
    // fixed, the key warnings will appear.)

    if (validType) {
      for (var i = 2; i < arguments.length; i++) {
        validateChildKeys(arguments[i], type);
      }
    }

    if (type === exports.Fragment) {
      validateFragmentProps(element);
    } else {
      validatePropTypes(element);
    }

    return element;
  }
  var didWarnAboutDeprecatedCreateFactory = false;
  function createFactoryWithValidation(type) {
    var validatedFactory = createElementWithValidation.bind(null, type);
    validatedFactory.type = type;

    {
      if (!didWarnAboutDeprecatedCreateFactory) {
        didWarnAboutDeprecatedCreateFactory = true;

        warn(
          "React.createFactory() is deprecated and will be removed in " +
            "a future major release. Consider using JSX " +
            "or use React.createElement() directly instead.",
        );
      } // Legacy hook: remove it

      Object.defineProperty(validatedFactory, "type", {
        enumerable: false,
        get: function () {
          warn(
            "Factory.type is deprecated. Access the class directly " +
              "before passing it to createFactory.",
          );

          Object.defineProperty(this, "type", {
            value: type,
          });
          return type;
        },
      });
    }

    return validatedFactory;
  }
  function cloneElementWithValidation(element, props, children) {
    var newElement = cloneElement.apply(this, arguments);

    for (var i = 2; i < arguments.length; i++) {
      validateChildKeys(arguments[i], newElement.type);
    }

    validatePropTypes(newElement);
    return newElement;
  }

  var enableSchedulerDebugging = false;
  var enableProfiling = false;

  var requestHostCallback;
  var requestHostTimeout;
  var cancelHostTimeout;
  var shouldYieldToHost;
  var requestPaint;
  var getCurrentTime;
  var forceFrameRate;
  var hasPerformanceNow =
    typeof performance === "object" && typeof performance.now === "function";

  if (hasPerformanceNow) {
    var localPerformance = performance;

    getCurrentTime = function () {
      return localPerformance.now();
    };
  } else {
    var localDate = Date;
    var initialTime = localDate.now();

    getCurrentTime = function () {
      return localDate.now() - initialTime;
    };
  }

  if (
    // If Scheduler runs in a non-DOM environment, it falls back to a naive
    // implementation using setTimeout.
    typeof window === "undefined" || // Check if MessageChannel is supported, too.
    typeof MessageChannel !== "function"
  ) {
    // If this accidentally gets imported in a non-browser environment, e.g. JavaScriptCore,
    // fallback to a naive implementation.
    var _callback = null;
    var _timeoutID = null;

    var _flushCallback = function () {
      if (_callback !== null) {
        try {
          var currentTime = getCurrentTime();
          var hasRemainingTime = true;

          _callback(hasRemainingTime, currentTime);

          _callback = null;
        } catch (e) {
          setTimeout(_flushCallback, 0);
          throw e;
        }
      }
    };

    requestHostCallback = function (cb) {
      if (_callback !== null) {
        // Protect against re-entrancy.
        setTimeout(requestHostCallback, 0, cb);
      } else {
        _callback = cb;
        setTimeout(_flushCallback, 0);
      }
    };

    requestHostTimeout = function (cb, ms) {
      _timeoutID = setTimeout(cb, ms);
    };

    cancelHostTimeout = function () {
      clearTimeout(_timeoutID);
    };

    shouldYieldToHost = function () {
      return false;
    };

    requestPaint = forceFrameRate = function () {};
  } else {
    // Capture local references to native APIs, in case a polyfill overrides them.
    var _setTimeout = window.setTimeout;
    var _clearTimeout = window.clearTimeout;

    if (typeof console !== "undefined") {
      // TODO: Scheduler no longer requires these methods to be polyfilled. But
      // maybe we want to continue warning if they don't exist, to preserve the
      // option to rely on it in the future?
      var requestAnimationFrame = window.requestAnimationFrame;
      var cancelAnimationFrame = window.cancelAnimationFrame;

      if (typeof requestAnimationFrame !== "function") {
        // Using console['error'] to evade Babel and ESLint
        console["error"](
          "This browser doesn't support requestAnimationFrame. " +
            "Make sure that you load a " +
            "polyfill in older browsers. https://reactjs.org/link/react-polyfills",
        );
      }

      if (typeof cancelAnimationFrame !== "function") {
        // Using console['error'] to evade Babel and ESLint
        console["error"](
          "This browser doesn't support cancelAnimationFrame. " +
            "Make sure that you load a " +
            "polyfill in older browsers. https://reactjs.org/link/react-polyfills",
        );
      }
    }

    var isMessageLoopRunning = false;
    var scheduledHostCallback = null;
    var taskTimeoutID = -1; // Scheduler periodically yields in case there is other work on the main
    // thread, like user events. By default, it yields multiple times per frame.
    // It does not attempt to align with frame boundaries, since most tasks don't
    // need to be frame aligned; for those that do, use requestAnimationFrame.

    var yieldInterval = 5;
    var deadline = 0; // TODO: Make this configurable

    {
      // `isInputPending` is not available. Since we have no way of knowing if
      // there's pending input, always yield at the end of the frame.
      shouldYieldToHost = function () {
        return getCurrentTime() >= deadline;
      }; // Since we yield every frame regardless, `requestPaint` has no effect.

      requestPaint = function () {};
    }

    forceFrameRate = function (fps) {
      if (fps < 0 || fps > 125) {
        // Using console['error'] to evade Babel and ESLint
        console["error"](
          "forceFrameRate takes a positive int between 0 and 125, " +
            "forcing frame rates higher than 125 fps is not supported",
        );
        return;
      }

      if (fps > 0) {
        yieldInterval = Math.floor(1000 / fps);
      } else {
        // reset the framerate
        yieldInterval = 5;
      }
    };

    var performWorkUntilDeadline = function () {
      if (scheduledHostCallback !== null) {
        var currentTime = getCurrentTime(); // Yield after `yieldInterval` ms, regardless of where we are in the vsync
        // cycle. This means there's always time remaining at the beginning of
        // the message event.

        deadline = currentTime + yieldInterval;
        var hasTimeRemaining = true;

        try {
          var hasMoreWork = scheduledHostCallback(
            hasTimeRemaining,
            currentTime,
          );

          if (!hasMoreWork) {
            isMessageLoopRunning = false;
            scheduledHostCallback = null;
          } else {
            // If there's more work, schedule the next message event at the end
            // of the preceding one.
            port.postMessage(null);
          }
        } catch (error) {
          // If a scheduler task throws, exit the current browser task so the
          // error can be observed.
          port.postMessage(null);
          throw error;
        }
      } else {
        isMessageLoopRunning = false;
      } // Yielding to the browser will give it a chance to paint, so we can
    };

    var channel = new MessageChannel();
    var port = channel.port2;
    channel.port1.onmessage = performWorkUntilDeadline;

    requestHostCallback = function (callback) {
      scheduledHostCallback = callback;

      if (!isMessageLoopRunning) {
        isMessageLoopRunning = true;
        port.postMessage(null);
      }
    };

    requestHostTimeout = function (callback, ms) {
      taskTimeoutID = _setTimeout(function () {
        callback(getCurrentTime());
      }, ms);
    };

    cancelHostTimeout = function () {
      _clearTimeout(taskTimeoutID);

      taskTimeoutID = -1;
    };
  }

  function push(heap, node) {
    var index = heap.length;
    heap.push(node);
    siftUp(heap, node, index);
  }
  function peek(heap) {
    var first = heap[0];
    return first === undefined ? null : first;
  }
  function pop(heap) {
    var first = heap[0];

    if (first !== undefined) {
      var last = heap.pop();

      if (last !== first) {
        heap[0] = last;
        siftDown(heap, last, 0);
      }

      return first;
    } else {
      return null;
    }
  }

  function siftUp(heap, node, i) {
    var index = i;

    while (true) {
      var parentIndex = (index - 1) >>> 1;
      var parent = heap[parentIndex];

      if (parent !== undefined && compare(parent, node) > 0) {
        // The parent is larger. Swap positions.
        heap[parentIndex] = node;
        heap[index] = parent;
        index = parentIndex;
      } else {
        // The parent is smaller. Exit.
        return;
      }
    }
  }

  function siftDown(heap, node, i) {
    var index = i;
    var length = heap.length;

    while (index < length) {
      var leftIndex = (index + 1) * 2 - 1;
      var left = heap[leftIndex];
      var rightIndex = leftIndex + 1;
      var right = heap[rightIndex]; // If the left or right node is smaller, swap with the smaller of those.

      if (left !== undefined && compare(left, node) < 0) {
        if (right !== undefined && compare(right, left) < 0) {
          heap[index] = right;
          heap[rightIndex] = node;
          index = rightIndex;
        } else {
          heap[index] = left;
          heap[leftIndex] = node;
          index = leftIndex;
        }
      } else if (right !== undefined && compare(right, node) < 0) {
        heap[index] = right;
        heap[rightIndex] = node;
        index = rightIndex;
      } else {
        // Neither child is smaller. Exit.
        return;
      }
    }
  }

  function compare(a, b) {
    // Compare sort index first, then task id.
    var diff = a.sortIndex - b.sortIndex;
    return diff !== 0 ? diff : a.id - b.id;
  }

  // TODO: Use symbols?
  var ImmediatePriority = 1;
  var UserBlockingPriority = 2;
  var NormalPriority = 3;
  var LowPriority = 4;
  var IdlePriority = 5;

  function markTaskErrored(task, ms) {}

  /* eslint-disable no-var */
  // Math.pow(2, 30) - 1
  // 0b111111111111111111111111111111

  var maxSigned31BitInt = 1073741823; // Times out immediately

  var IMMEDIATE_PRIORITY_TIMEOUT = -1; // Eventually times out

  var USER_BLOCKING_PRIORITY_TIMEOUT = 250;
  var NORMAL_PRIORITY_TIMEOUT = 5000;
  var LOW_PRIORITY_TIMEOUT = 10000; // Never times out

  var IDLE_PRIORITY_TIMEOUT = maxSigned31BitInt; // Tasks are stored on a min heap

  var taskQueue = [];
  var timerQueue = []; // Incrementing id counter. Used to maintain insertion order.

  var taskIdCounter = 1; // Pausing the scheduler is useful for debugging.
  var currentTask = null;
  var currentPriorityLevel = NormalPriority; // This is set while performing work, to prevent re-entrancy.

  var isPerformingWork = false;
  var isHostCallbackScheduled = false;
  var isHostTimeoutScheduled = false;

  function advanceTimers(currentTime) {
    // Check for tasks that are no longer delayed and add them to the queue.
    var timer = peek(timerQueue);

    while (timer !== null) {
      if (timer.callback === null) {
        // Timer was cancelled.
        pop(timerQueue);
      } else if (timer.startTime <= currentTime) {
        // Timer fired. Transfer to the task queue.
        pop(timerQueue);
        timer.sortIndex = timer.expirationTime;
        push(taskQueue, timer);
      } else {
        // Remaining timers are pending.
        return;
      }

      timer = peek(timerQueue);
    }
  }

  function handleTimeout(currentTime) {
    isHostTimeoutScheduled = false;
    advanceTimers(currentTime);

    if (!isHostCallbackScheduled) {
      if (peek(taskQueue) !== null) {
        isHostCallbackScheduled = true;
        requestHostCallback(flushWork);
      } else {
        var firstTimer = peek(timerQueue);

        if (firstTimer !== null) {
          requestHostTimeout(handleTimeout, firstTimer.startTime - currentTime);
        }
      }
    }
  }

  function flushWork(hasTimeRemaining, initialTime) {
    isHostCallbackScheduled = false;

    if (isHostTimeoutScheduled) {
      // We scheduled a timeout but it's no longer needed. Cancel it.
      isHostTimeoutScheduled = false;
      cancelHostTimeout();
    }

    isPerformingWork = true;
    var previousPriorityLevel = currentPriorityLevel;

    try {
      if (enableProfiling) {
        try {
          return workLoop(hasTimeRemaining, initialTime);
        } catch (error) {
          if (currentTask !== null) {
            var currentTime = getCurrentTime();
            markTaskErrored(currentTask, currentTime);
            currentTask.isQueued = false;
          }

          throw error;
        }
      } else {
        // No catch in prod code path.
        return workLoop(hasTimeRemaining, initialTime);
      }
    } finally {
      currentTask = null;
      currentPriorityLevel = previousPriorityLevel;
      isPerformingWork = false;
    }
  }

  function workLoop(hasTimeRemaining, initialTime) {
    var currentTime = initialTime;
    advanceTimers(currentTime);
    currentTask = peek(taskQueue);

    while (currentTask !== null && !enableSchedulerDebugging) {
      if (
        currentTask.expirationTime > currentTime &&
        (!hasTimeRemaining || shouldYieldToHost())
      ) {
        // This currentTask hasn't expired, and we've reached the deadline.
        break;
      }

      var callback = currentTask.callback;

      if (typeof callback === "function") {
        currentTask.callback = null;
        currentPriorityLevel = currentTask.priorityLevel;
        var didUserCallbackTimeout = currentTask.expirationTime <= currentTime;

        var continuationCallback = callback(didUserCallbackTimeout);
        currentTime = getCurrentTime();

        if (typeof continuationCallback === "function") {
          currentTask.callback = continuationCallback;
        } else {
          if (currentTask === peek(taskQueue)) {
            pop(taskQueue);
          }
        }

        advanceTimers(currentTime);
      } else {
        pop(taskQueue);
      }

      currentTask = peek(taskQueue);
    } // Return whether there's additional work

    if (currentTask !== null) {
      return true;
    } else {
      var firstTimer = peek(timerQueue);

      if (firstTimer !== null) {
        requestHostTimeout(handleTimeout, firstTimer.startTime - currentTime);
      }

      return false;
    }
  }

  function unstable_runWithPriority(priorityLevel, eventHandler) {
    switch (priorityLevel) {
      case ImmediatePriority:
      case UserBlockingPriority:
      case NormalPriority:
      case LowPriority:
      case IdlePriority:
        break;

      default:
        priorityLevel = NormalPriority;
    }

    var previousPriorityLevel = currentPriorityLevel;
    currentPriorityLevel = priorityLevel;

    try {
      return eventHandler();
    } finally {
      currentPriorityLevel = previousPriorityLevel;
    }
  }

  function unstable_next(eventHandler) {
    var priorityLevel;

    switch (currentPriorityLevel) {
      case ImmediatePriority:
      case UserBlockingPriority:
      case NormalPriority:
        // Shift down to normal priority
        priorityLevel = NormalPriority;
        break;

      default:
        // Anything lower than normal priority should remain at the current level.
        priorityLevel = currentPriorityLevel;
        break;
    }

    var previousPriorityLevel = currentPriorityLevel;
    currentPriorityLevel = priorityLevel;

    try {
      return eventHandler();
    } finally {
      currentPriorityLevel = previousPriorityLevel;
    }
  }

  function unstable_wrapCallback(callback) {
    var parentPriorityLevel = currentPriorityLevel;
    return function () {
      // This is a fork of runWithPriority, inlined for performance.
      var previousPriorityLevel = currentPriorityLevel;
      currentPriorityLevel = parentPriorityLevel;

      try {
        return callback.apply(this, arguments);
      } finally {
        currentPriorityLevel = previousPriorityLevel;
      }
    };
  }

  function unstable_scheduleCallback(priorityLevel, callback, options) {
    var currentTime = getCurrentTime();
    var startTime;

    if (typeof options === "object" && options !== null) {
      var delay = options.delay;

      if (typeof delay === "number" && delay > 0) {
        startTime = currentTime + delay;
      } else {
        startTime = currentTime;
      }
    } else {
      startTime = currentTime;
    }

    var timeout;

    switch (priorityLevel) {
      case ImmediatePriority:
        timeout = IMMEDIATE_PRIORITY_TIMEOUT;
        break;

      case UserBlockingPriority:
        timeout = USER_BLOCKING_PRIORITY_TIMEOUT;
        break;

      case IdlePriority:
        timeout = IDLE_PRIORITY_TIMEOUT;
        break;

      case LowPriority:
        timeout = LOW_PRIORITY_TIMEOUT;
        break;

      case NormalPriority:
      default:
        timeout = NORMAL_PRIORITY_TIMEOUT;
        break;
    }

    var expirationTime = startTime + timeout;
    var newTask = {
      id: taskIdCounter++,
      callback: callback,
      priorityLevel: priorityLevel,
      startTime: startTime,
      expirationTime: expirationTime,
      sortIndex: -1,
    };

    if (startTime > currentTime) {
      // This is a delayed task.
      newTask.sortIndex = startTime;
      push(timerQueue, newTask);

      if (peek(taskQueue) === null && newTask === peek(timerQueue)) {
        // All tasks are delayed, and this is the task with the earliest delay.
        if (isHostTimeoutScheduled) {
          // Cancel an existing timeout.
          cancelHostTimeout();
        } else {
          isHostTimeoutScheduled = true;
        } // Schedule a timeout.

        requestHostTimeout(handleTimeout, startTime - currentTime);
      }
    } else {
      newTask.sortIndex = expirationTime;
      push(taskQueue, newTask);
      // wait until the next time we yield.

      if (!isHostCallbackScheduled && !isPerformingWork) {
        isHostCallbackScheduled = true;
        requestHostCallback(flushWork);
      }
    }

    return newTask;
  }

  function unstable_pauseExecution() {}

  function unstable_continueExecution() {
    if (!isHostCallbackScheduled && !isPerformingWork) {
      isHostCallbackScheduled = true;
      requestHostCallback(flushWork);
    }
  }

  function unstable_getFirstCallbackNode() {
    return peek(taskQueue);
  }

  function unstable_cancelCallback(task) {
    // remove from the queue because you can't remove arbitrary nodes from an
    // array based heap, only the first one.)

    task.callback = null;
  }

  function unstable_getCurrentPriorityLevel() {
    return currentPriorityLevel;
  }

  var unstable_requestPaint = requestPaint;
  var unstable_Profiling = null;

  var Scheduler = /*#__PURE__*/ Object.freeze({
    __proto__: null,
    unstable_ImmediatePriority: ImmediatePriority,
    unstable_UserBlockingPriority: UserBlockingPriority,
    unstable_NormalPriority: NormalPriority,
    unstable_IdlePriority: IdlePriority,
    unstable_LowPriority: LowPriority,
    unstable_runWithPriority: unstable_runWithPriority,
    unstable_next: unstable_next,
    unstable_scheduleCallback: unstable_scheduleCallback,
    unstable_cancelCallback: unstable_cancelCallback,
    unstable_wrapCallback: unstable_wrapCallback,
    unstable_getCurrentPriorityLevel: unstable_getCurrentPriorityLevel,
    get unstable_shouldYield() {
      return shouldYieldToHost;
    },
    unstable_requestPaint: unstable_requestPaint,
    unstable_continueExecution: unstable_continueExecution,
    unstable_pauseExecution: unstable_pauseExecution,
    unstable_getFirstCallbackNode: unstable_getFirstCallbackNode,
    get unstable_now() {
      return getCurrentTime;
    },
    get unstable_forceFrameRate() {
      return forceFrameRate;
    },
    unstable_Profiling: unstable_Profiling,
  });

  var DEFAULT_THREAD_ID = 0; // Counters used to generate unique IDs.

  var interactionIDCounter = 0;
  var threadIDCounter = 0; // Set of currently traced interactions.
  // Interactions "stack"–
  // Meaning that newly traced interactions are appended to the previously active set.
  // When an interaction goes out of scope, the previous set (if any) is restored.

  var interactionsRef = null; // Listener(s) to notify when interactions begin and end.

  var subscriberRef = null;

  {
    interactionsRef = {
      current: new Set(),
    };
    subscriberRef = {
      current: null,
    };
  }
  function unstable_clear(callback) {
    var prevInteractions = interactionsRef.current;
    interactionsRef.current = new Set();

    try {
      return callback();
    } finally {
      interactionsRef.current = prevInteractions;
    }
  }
  function unstable_getCurrent() {
    {
      return interactionsRef.current;
    }
  }
  function unstable_getThreadID() {
    return ++threadIDCounter;
  }
  function unstable_trace(name, timestamp, callback) {
    var threadID =
      arguments.length > 3 && arguments[3] !== undefined
        ? arguments[3]
        : DEFAULT_THREAD_ID;

    var interaction = {
      __count: 1,
      id: interactionIDCounter++,
      name: name,
      timestamp: timestamp,
    };
    var prevInteractions = interactionsRef.current; // Traced interactions should stack/accumulate.
    // To do that, clone the current interactions.
    // The previous set will be restored upon completion.

    var interactions = new Set(prevInteractions);
    interactions.add(interaction);
    interactionsRef.current = interactions;
    var subscriber = subscriberRef.current;
    var returnValue;

    try {
      if (subscriber !== null) {
        subscriber.onInteractionTraced(interaction);
      }
    } finally {
      try {
        if (subscriber !== null) {
          subscriber.onWorkStarted(interactions, threadID);
        }
      } finally {
        try {
          returnValue = callback();
        } finally {
          interactionsRef.current = prevInteractions;

          try {
            if (subscriber !== null) {
              subscriber.onWorkStopped(interactions, threadID);
            }
          } finally {
            interaction.__count--; // If no async work was scheduled for this interaction,
            // Notify subscribers that it's completed.

            if (subscriber !== null && interaction.__count === 0) {
              subscriber.onInteractionScheduledWorkCompleted(interaction);
            }
          }
        }
      }
    }

    return returnValue;
  }
  function unstable_wrap(callback) {
    var threadID =
      arguments.length > 1 && arguments[1] !== undefined
        ? arguments[1]
        : DEFAULT_THREAD_ID;

    var wrappedInteractions = interactionsRef.current;
    var subscriber = subscriberRef.current;

    if (subscriber !== null) {
      subscriber.onWorkScheduled(wrappedInteractions, threadID);
    } // Update the pending async work count for the current interactions.
    // Update after calling subscribers in case of error.

    wrappedInteractions.forEach(function (interaction) {
      interaction.__count++;
    });
    var hasRun = false;

    function wrapped() {
      var prevInteractions = interactionsRef.current;
      interactionsRef.current = wrappedInteractions;
      subscriber = subscriberRef.current;

      try {
        var returnValue;

        try {
          if (subscriber !== null) {
            subscriber.onWorkStarted(wrappedInteractions, threadID);
          }
        } finally {
          try {
            returnValue = callback.apply(undefined, arguments);
          } finally {
            interactionsRef.current = prevInteractions;

            if (subscriber !== null) {
              subscriber.onWorkStopped(wrappedInteractions, threadID);
            }
          }
        }

        return returnValue;
      } finally {
        if (!hasRun) {
          // We only expect a wrapped function to be executed once,
          // But in the event that it's executed more than once–
          // Only decrement the outstanding interaction counts once.
          hasRun = true; // Update pending async counts for all wrapped interactions.
          // If this was the last scheduled async work for any of them,
          // Mark them as completed.

          wrappedInteractions.forEach(function (interaction) {
            interaction.__count--;

            if (subscriber !== null && interaction.__count === 0) {
              subscriber.onInteractionScheduledWorkCompleted(interaction);
            }
          });
        }
      }
    }

    wrapped.cancel = function cancel() {
      subscriber = subscriberRef.current;

      try {
        if (subscriber !== null) {
          subscriber.onWorkCanceled(wrappedInteractions, threadID);
        }
      } finally {
        // Update pending async counts for all wrapped interactions.
        // If this was the last scheduled async work for any of them,
        // Mark them as completed.
        wrappedInteractions.forEach(function (interaction) {
          interaction.__count--;

          if (subscriber && interaction.__count === 0) {
            subscriber.onInteractionScheduledWorkCompleted(interaction);
          }
        });
      }
    };

    return wrapped;
  }

  var subscribers = null;

  {
    subscribers = new Set();
  }

  function unstable_subscribe(subscriber) {
    {
      subscribers.add(subscriber);

      if (subscribers.size === 1) {
        subscriberRef.current = {
          onInteractionScheduledWorkCompleted:
            onInteractionScheduledWorkCompleted,
          onInteractionTraced: onInteractionTraced,
          onWorkCanceled: onWorkCanceled,
          onWorkScheduled: onWorkScheduled,
          onWorkStarted: onWorkStarted,
          onWorkStopped: onWorkStopped,
        };
      }
    }
  }
  function unstable_unsubscribe(subscriber) {
    {
      subscribers.delete(subscriber);

      if (subscribers.size === 0) {
        subscriberRef.current = null;
      }
    }
  }

  function onInteractionTraced(interaction) {
    var didCatchError = false;
    var caughtError = null;
    subscribers.forEach(function (subscriber) {
      try {
        subscriber.onInteractionTraced(interaction);
      } catch (error) {
        if (!didCatchError) {
          didCatchError = true;
          caughtError = error;
        }
      }
    });

    if (didCatchError) {
      throw caughtError;
    }
  }

  function onInteractionScheduledWorkCompleted(interaction) {
    var didCatchError = false;
    var caughtError = null;
    subscribers.forEach(function (subscriber) {
      try {
        subscriber.onInteractionScheduledWorkCompleted(interaction);
      } catch (error) {
        if (!didCatchError) {
          didCatchError = true;
          caughtError = error;
        }
      }
    });

    if (didCatchError) {
      throw caughtError;
    }
  }

  function onWorkScheduled(interactions, threadID) {
    var didCatchError = false;
    var caughtError = null;
    subscribers.forEach(function (subscriber) {
      try {
        subscriber.onWorkScheduled(interactions, threadID);
      } catch (error) {
        if (!didCatchError) {
          didCatchError = true;
          caughtError = error;
        }
      }
    });

    if (didCatchError) {
      throw caughtError;
    }
  }

  function onWorkStarted(interactions, threadID) {
    var didCatchError = false;
    var caughtError = null;
    subscribers.forEach(function (subscriber) {
      try {
        subscriber.onWorkStarted(interactions, threadID);
      } catch (error) {
        if (!didCatchError) {
          didCatchError = true;
          caughtError = error;
        }
      }
    });

    if (didCatchError) {
      throw caughtError;
    }
  }

  function onWorkStopped(interactions, threadID) {
    var didCatchError = false;
    var caughtError = null;
    subscribers.forEach(function (subscriber) {
      try {
        subscriber.onWorkStopped(interactions, threadID);
      } catch (error) {
        if (!didCatchError) {
          didCatchError = true;
          caughtError = error;
        }
      }
    });

    if (didCatchError) {
      throw caughtError;
    }
  }

  function onWorkCanceled(interactions, threadID) {
    var didCatchError = false;
    var caughtError = null;
    subscribers.forEach(function (subscriber) {
      try {
        subscriber.onWorkCanceled(interactions, threadID);
      } catch (error) {
        if (!didCatchError) {
          didCatchError = true;
          caughtError = error;
        }
      }
    });

    if (didCatchError) {
      throw caughtError;
    }
  }

  var SchedulerTracing = /*#__PURE__*/ Object.freeze({
    __proto__: null,
    get __interactionsRef() {
      return interactionsRef;
    },
    get __subscriberRef() {
      return subscriberRef;
    },
    unstable_clear: unstable_clear,
    unstable_getCurrent: unstable_getCurrent,
    unstable_getThreadID: unstable_getThreadID,
    unstable_trace: unstable_trace,
    unstable_wrap: unstable_wrap,
    unstable_subscribe: unstable_subscribe,
    unstable_unsubscribe: unstable_unsubscribe,
  });

  var ReactSharedInternals$1 = {
    ReactCurrentDispatcher: ReactCurrentDispatcher,
    ReactCurrentOwner: ReactCurrentOwner,
    IsSomeRendererActing: IsSomeRendererActing,
    ReactCurrentBatchConfig: ReactCurrentBatchConfig,
    // Used by renderers to avoid bundling object-assign twice in UMD bundles:
    assign: assign,
    // Re-export the schedule API(s) for UMD bundles.
    // This avoids introducing a dependency on a new UMD global in a minor update,
    // Since that would be a breaking change (e.g. for all existing CodeSandboxes).
    // This re-export is only required for UMD bundles;
    // CJS bundles use the shared NPM package.
    Scheduler: Scheduler,
    SchedulerTracing: SchedulerTracing,
  };

  {
    ReactSharedInternals$1.ReactDebugCurrentFrame = ReactDebugCurrentFrame;
  }

  {
    try {
      var frozenObject = Object.freeze({});
      /* eslint-disable no-new */

      new Map([[frozenObject, null]]);
      new Set([frozenObject]);
      /* eslint-enable no-new */
    } catch (e) {}
  }

  var createElement$1 = createElementWithValidation;
  var cloneElement$1 = cloneElementWithValidation;
  var createFactory = createFactoryWithValidation;
  var Children = {
    map: mapChildren,
    forEach: forEachChildren,
    count: countChildren,
    toArray: toArray,
    only: onlyChild,
  };

  exports.Children = Children;
  exports.Component = Component;
  exports.PureComponent = PureComponent;
  exports.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED =
    ReactSharedInternals$1;
  exports.cloneElement = cloneElement$1;
  exports.createContext = createContext;
  exports.createElement = createElement$1;
  exports.createFactory = createFactory;
  exports.createRef = createRef;
  exports.forwardRef = forwardRef;
  exports.isValidElement = isValidElement;
  exports.lazy = lazy;
  exports.memo = memo;
  exports.useCallback = useCallback;
  exports.useContext = useContext;
  exports.useDebugValue = useDebugValue;
  exports.useEffect = useEffect;
  exports.useImperativeHandle = useImperativeHandle;
  exports.useLayoutEffect = useLayoutEffect;
  exports.useMemo = useMemo;
  exports.useReducer = useReducer;
  exports.useRef = useRef;
  exports.useState = useState;
  exports.version = ReactVersion;
});
