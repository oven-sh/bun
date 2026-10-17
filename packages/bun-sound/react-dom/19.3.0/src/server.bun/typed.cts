/// <reference path="./fz-shapes-04.d.ts" />
/// <reference path="./fz-shapes-05.d.ts" />
/// <reference path="./fz-shapes.d.ts" />
/**
 * @license React
 * react-dom-server.bun.production.js
 *
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

"use strict";
var React: FZ.ReactModule = require("react"),
  ReactDOM: FZ.ReactDOMModule = require("react-dom"),
  util: FZ.UtilModule = require("util");
require("crypto");
var stream: FZ.StreamModule = require("stream"),
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
  REACT_SCOPE_TYPE = Symbol.for("react.scope"),
  REACT_ACTIVITY_TYPE = Symbol.for("react.activity"),
  REACT_LEGACY_HIDDEN_TYPE = Symbol.for("react.legacy_hidden"),
  REACT_MEMO_CACHE_SENTINEL = Symbol.for("react.memo_cache_sentinel"),
  REACT_VIEW_TRANSITION_TYPE = Symbol.for("react.view_transition"),
  REACT_RECOVERABLE_TYPE = Symbol.for("react.recoverable"),
  MAYBE_ITERATOR_SYMBOL = Symbol.iterator;
function getIteratorFn(maybeIterable: FZ.ReactNode): FZ.IteratorFn {
  if (null === maybeIterable || "object" !== typeof maybeIterable) return null;
  maybeIterable =
    (MAYBE_ITERATOR_SYMBOL && maybeIterable[MAYBE_ITERATOR_SYMBOL]) ||
    maybeIterable["@@iterator"];
  return "function" === typeof maybeIterable ? maybeIterable : null;
}
var REACT_OPTIMISTIC_KEY = Symbol.for("react.optimistic_key"),
  isArrayImpl = Array.isArray,
  scheduleMicrotask = queueMicrotask;
function flushBuffered(destination: FZ.Destination): void {
  "function" === typeof destination.flush && destination.flush();
}
function writeChunk(destination: FZ.Destination, chunk: FZ.Chunk): void {
  0 !== chunk.length && destination.write(chunk);
}
function byteLengthOfChunk(chunk: FZ.Chunk): number {
  return Buffer.byteLength(chunk, "utf8");
}
function closeWithError(destination: FZ.Destination, error: FZ.Thrown): void {
  "function" === typeof destination.error
    ? destination.error(error)
    : "function" === typeof destination.destroy
      ? destination.destroy(error)
      : "function" === typeof destination.close && destination.close();
}
var assign: FZ.Assign = Object.assign,
  hasOwnProperty = Object.prototype.hasOwnProperty,
  VALID_ATTRIBUTE_NAME_REGEX = RegExp(
    "^[:A-Z_a-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD][:A-Z_a-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD\\-.0-9\\u00B7\\u0300-\\u036F\\u203F-\\u2040]*$"
  ),
  illegalAttributeNameCache: FZ.NameCache = {},
  validatedAttributeNameCache: FZ.NameCache = {};
function isAttributeNameSafe(attributeName: string): boolean {
  if (hasOwnProperty.call(validatedAttributeNameCache, attributeName))
    return !0;
  if (hasOwnProperty.call(illegalAttributeNameCache, attributeName)) return !1;
  if (VALID_ATTRIBUTE_NAME_REGEX.test(attributeName))
    return (validatedAttributeNameCache[attributeName] = !0);
  illegalAttributeNameCache[attributeName] = !0;
  return !1;
}
var unitlessNumbers = new Set(
    "animationIterationCount aspectRatio borderImageOutset borderImageSlice borderImageWidth boxFlex boxFlexGroup boxOrdinalGroup columnCount columns flex flexGrow flexPositive flexShrink flexNegative flexOrder gridArea gridRow gridRowEnd gridRowSpan gridRowStart gridColumn gridColumnEnd gridColumnSpan gridColumnStart fontWeight lineClamp lineHeight opacity order orphans scale tabSize widows zIndex zoom fillOpacity floodOpacity stopOpacity strokeDasharray strokeDashoffset strokeMiterlimit strokeOpacity strokeWidth MozAnimationIterationCount MozBoxFlex MozBoxFlexGroup MozLineClamp msAnimationIterationCount msFlex msZoom msFlexGrow msFlexNegative msFlexOrder msFlexPositive msFlexShrink msGridColumn msGridColumnSpan msGridRow msGridRowSpan WebkitAnimationIterationCount WebkitBoxFlex WebKitBoxFlexGroup WebkitBoxOrdinalGroup WebkitColumnCount WebkitColumns WebkitFlex WebkitFlexGrow WebkitFlexPositive WebkitFlexShrink WebkitLineClamp".split(
      " "
    )
  ),
  aliases = new Map([
    ["acceptCharset", "accept-charset"],
    ["htmlFor", "for"],
    ["httpEquiv", "http-equiv"],
    ["crossOrigin", "crossorigin"],
    ["accentHeight", "accent-height"],
    ["alignmentBaseline", "alignment-baseline"],
    ["arabicForm", "arabic-form"],
    ["baselineShift", "baseline-shift"],
    ["capHeight", "cap-height"],
    ["clipPath", "clip-path"],
    ["clipRule", "clip-rule"],
    ["colorInterpolation", "color-interpolation"],
    ["colorInterpolationFilters", "color-interpolation-filters"],
    ["colorProfile", "color-profile"],
    ["colorRendering", "color-rendering"],
    ["dominantBaseline", "dominant-baseline"],
    ["enableBackground", "enable-background"],
    ["fillOpacity", "fill-opacity"],
    ["fillRule", "fill-rule"],
    ["floodColor", "flood-color"],
    ["floodOpacity", "flood-opacity"],
    ["fontFamily", "font-family"],
    ["fontSize", "font-size"],
    ["fontSizeAdjust", "font-size-adjust"],
    ["fontStretch", "font-stretch"],
    ["fontStyle", "font-style"],
    ["fontVariant", "font-variant"],
    ["fontWeight", "font-weight"],
    ["glyphName", "glyph-name"],
    ["glyphOrientationHorizontal", "glyph-orientation-horizontal"],
    ["glyphOrientationVertical", "glyph-orientation-vertical"],
    ["horizAdvX", "horiz-adv-x"],
    ["horizOriginX", "horiz-origin-x"],
    ["imageRendering", "image-rendering"],
    ["letterSpacing", "letter-spacing"],
    ["lightingColor", "lighting-color"],
    ["markerEnd", "marker-end"],
    ["markerMid", "marker-mid"],
    ["markerStart", "marker-start"],
    ["maskType", "mask-type"],
    ["overlinePosition", "overline-position"],
    ["overlineThickness", "overline-thickness"],
    ["paintOrder", "paint-order"],
    ["panose-1", "panose-1"],
    ["pointerEvents", "pointer-events"],
    ["renderingIntent", "rendering-intent"],
    ["shapeRendering", "shape-rendering"],
    ["stopColor", "stop-color"],
    ["stopOpacity", "stop-opacity"],
    ["strikethroughPosition", "strikethrough-position"],
    ["strikethroughThickness", "strikethrough-thickness"],
    ["strokeDasharray", "stroke-dasharray"],
    ["strokeDashoffset", "stroke-dashoffset"],
    ["strokeLinecap", "stroke-linecap"],
    ["strokeLinejoin", "stroke-linejoin"],
    ["strokeMiterlimit", "stroke-miterlimit"],
    ["strokeOpacity", "stroke-opacity"],
    ["strokeWidth", "stroke-width"],
    ["textAnchor", "text-anchor"],
    ["textDecoration", "text-decoration"],
    ["textRendering", "text-rendering"],
    ["transformOrigin", "transform-origin"],
    ["underlinePosition", "underline-position"],
    ["underlineThickness", "underline-thickness"],
    ["unicodeBidi", "unicode-bidi"],
    ["unicodeRange", "unicode-range"],
    ["unitsPerEm", "units-per-em"],
    ["vAlphabetic", "v-alphabetic"],
    ["vHanging", "v-hanging"],
    ["vIdeographic", "v-ideographic"],
    ["vMathematical", "v-mathematical"],
    ["vectorEffect", "vector-effect"],
    ["vertAdvY", "vert-adv-y"],
    ["vertOriginX", "vert-origin-x"],
    ["vertOriginY", "vert-origin-y"],
    ["wordSpacing", "word-spacing"],
    ["writingMode", "writing-mode"],
    ["xmlnsXlink", "xmlns:xlink"],
    ["xHeight", "x-height"]
  ]),
  matchHtmlRegExp = /["'&<>]/;
function escapeTextForBrowser(text: FZ.PropValue): string { /*$*/var text$asString: string, match$asEscape: string;/*$*/
  if (
    "boolean" === typeof text ||
    "number" === typeof text ||
    "bigint" === typeof text
  )
    return "" + text;
  text$asString = "" + text;
  var match: RegExpExecArray | null = matchHtmlRegExp.exec(text$asString);
  if (match) {
    var html = "",
      index: FZ.int32,
      lastIndex: FZ.int32 = 0;
    for (index = match.index as FZ.int32; index < text$asString.length; index++) {
      switch (text$asString.charCodeAt(index)) {
        case 34:
          match$asEscape = "&quot;";
          break;
        case 38:
          match$asEscape = "&amp;";
          break;
        case 39:
          match$asEscape = "&#x27;";
          break;
        case 60:
          match$asEscape = "&lt;";
          break;
        case 62:
          match$asEscape = "&gt;";
          break;
        default:
          continue;
      }
      lastIndex !== index && (html += text$asString.slice(lastIndex, index));
      lastIndex = index + 1;
      html += match$asEscape;
    }
    text$asString = lastIndex !== index ? html + text$asString.slice(lastIndex, index) : html;
  }
  return text$asString;
}
var uppercasePattern = /([A-Z])/g,
  msPattern = /^ms-/,
  isJavaScriptProtocol =
    /^[\u0000-\u001F ]*j[\r\n\t]*a[\r\n\t]*v[\r\n\t]*a[\r\n\t]*s[\r\n\t]*c[\r\n\t]*r[\r\n\t]*i[\r\n\t]*p[\r\n\t]*t[\r\n\t]*:/i;
function sanitizeURL<T>(url: T): T | string {
  return isJavaScriptProtocol.test("" + url)
    ? "javascript:throw new Error('React has blocked a javascript: URL as a security precaution.')"
    : url;
}
var ReactSharedInternals: FZ.SharedInternals =
    React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE,
  ReactDOMSharedInternals: FZ.DOMSharedInternals =
    ReactDOM.__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE,
  sharedNotPendingObject: FZ.FormStatusNotPending = {
    pending: !1,
    data: null,
    method: null,
    action: null
  },
  previousDispatcher: FZ.HostDispatcherGiven = ReactDOMSharedInternals.d;
ReactDOMSharedInternals.d = {
  f: previousDispatcher.f,
  r: previousDispatcher.r,
  D: prefetchDNS,
  C: preconnect,
  L: preload,
  m: preloadModule,
  X: preinitScript,
  S: preinitStyle,
  M: preinitModuleScript
}/*$*/ as FZ.HostDispatcher/*$*/;
var PRELOAD_NO_CREDS: FZ.PreloadState = [],
  currentlyFlushingRenderState: FZ.RenderState | null = null,
  scriptRegex = /(<\/|<)(s)(cript)/gi;
function scriptReplacer(match: string, prefix: string, s: string, suffix: string): string {
  return "" + prefix + ("s" === s ? "\\u0073" : "\\u0053") + suffix;
}
function createRenderState(
  resumableState: FZ.ResumableState,
  nonce$given: FZ.Nonce,
  externalRuntimeConfig: FZ.PropValue,
  importMap$given: FZ.ImportMap,
  onHeaders$given: FZ.OnHeaders | null | undefined,
  maxHeadersLength: FZ.PropValue
): FZ.RenderState { /*$*/var nonce, importMap, onHeaders; nonce = nonce$given; importMap = importMap$given; onHeaders = onHeaders$given; var onHeaders$asState: FZ.RenderState;/*$*/ /*$*/var idPrefix$asScript: FZ.PropValue;/*$*/ /*$*/var idPrefix$asState: FZ.ResumableState;/*$*/ /*$*/var idPrefix$asResource: FZ.Resource;/*$*/ /*$*/var nonceStyle$asState: FZ.ResumableState;/*$*/ /*$*/var nonceStyle$asResource: FZ.Resource;/*$*/ /*$*/var inlineStyleWithNonce$asProps: FZ.PropsBag;/*$*/ /*$*/var inlineStyleWithNonce$asSrc: FZ.PropValue;/*$*/ /*$*/var inlineScriptWithNonce$asProps: FZ.PropsBag;/*$*/ /*$*/var bootstrapScriptContent$asChunks: FZ.Chunk[];/*$*/
  externalRuntimeConfig =
    "string" === typeof nonce ? nonce : nonce && nonce.script;
  var inlineScriptWithNonce: string | undefined =
      void 0 === externalRuntimeConfig
        ? "<script"
        : '<script nonce="' + escapeTextForBrowser(externalRuntimeConfig) + '"',
    nonceStyle: FZ.PropValue = "string" === typeof nonce ? void 0 : nonce && nonce.style,
    inlineStyleWithNonce =
      void 0 === nonceStyle
        ? "<style"
        : '<style nonce="' + escapeTextForBrowser(nonceStyle) + '"',
    idPrefix = resumableState.idPrefix,
    bootstrapChunks: FZ.Chunk[] = [],
    bootstrapScriptContent = resumableState.bootstrapScriptContent,
    bootstrapScripts = resumableState.bootstrapScripts,
    bootstrapModules = resumableState.bootstrapModules;
  void 0 !== bootstrapScriptContent &&
    (bootstrapChunks.push(inlineScriptWithNonce),
    pushCompletedShellIdAttribute(bootstrapChunks, resumableState),
    bootstrapChunks.push(
      ">",
      ("" + bootstrapScriptContent).replace(scriptRegex, scriptReplacer),
      "\x3c/script>"
    ));
  bootstrapScriptContent$asChunks = [];
  void 0 !== importMap &&
    (bootstrapScriptContent$asChunks.push(
      void 0 === externalRuntimeConfig
        ? '<script type="importmap">'
        : '<script type="importmap" nonce="' +
            escapeTextForBrowser(externalRuntimeConfig) +
            '">'
    ),
    bootstrapScriptContent$asChunks.push(
      ("" + JSON.stringify(importMap)).replace(scriptRegex, scriptReplacer)
    ),
    bootstrapScriptContent$asChunks.push("\x3c/script>"));
  importMap = onHeaders
    ? {
        preconnects: "",
        fontPreloads: "",
        highImagePreloads: "",
        remainingCapacity:
          2 + ("number" === typeof maxHeadersLength ? maxHeadersLength : 2e3)
      }/*$*/ as FZ.PreloadHeaders/*$*/
    : null;
  onHeaders$asState = {
    placeholderPrefix: idPrefix + "P:",
    segmentPrefix: idPrefix + "S:",
    boundaryPrefix: idPrefix + "B:",
    startInlineScript: inlineScriptWithNonce,
    startInlineStyle: inlineStyleWithNonce,
    preamble: createPreambleState(),
    externalRuntimeScript: null,
    bootstrapChunks: bootstrapChunks,
    importMapChunks: bootstrapScriptContent$asChunks,
    onHeaders: onHeaders,
    headers: importMap,
    resets: {
      font: {},
      dns: {},
      connect: { default: {}, anonymous: {}, credentials: {} },
      image: {},
      style: {}
    },
    charsetChunks: [],
    viewportChunks: [],
    hoistableChunks: [],
    preconnects: new Set(),
    fontPreloads: new Set(),
    highImagePreloads: new Set(),
    styles: new Map(),
    bootstrapScripts: new Set(),
    scripts: new Set(),
    bulkPreloads: new Set(),
    preloads: {
      images: new Map(),
      stylesheets: new Map(),
      scripts: new Map(),
      moduleScripts: new Map()
    },
    nonce: { script: externalRuntimeConfig, style: nonceStyle },
    hoistableState: null,
    stylesToHoist: !1
  }/*$*/ as FZ.RenderState/*$*/;
  if (void 0 !== bootstrapScripts)
    for (importMap = 0; importMap < bootstrapScripts.length; importMap++)
      (idPrefix$asScript = bootstrapScripts[importMap]),
        (nonceStyle = inlineScriptWithNonce = void 0),
        (inlineStyleWithNonce$asProps = {
          rel: "preload",
          as: "script",
          fetchPriority: "low",
          nonce: nonce
        }),
        "string" === typeof idPrefix$asScript
          ? (inlineStyleWithNonce$asProps.href = maxHeadersLength = idPrefix$asScript)
          : ((inlineStyleWithNonce$asProps.href = maxHeadersLength = idPrefix$asScript.src),
            (inlineStyleWithNonce$asProps.integrity = nonceStyle =
              "string" === typeof idPrefix$asScript.integrity
                ? idPrefix$asScript.integrity
                : void 0),
            (inlineStyleWithNonce$asProps.crossOrigin = inlineScriptWithNonce =
              "string" === typeof idPrefix$asScript || null == idPrefix$asScript.crossOrigin
                ? void 0
                : "use-credentials" === idPrefix$asScript.crossOrigin
                  ? "use-credentials"
                  : "")),
        (idPrefix$asState = resumableState),
        (bootstrapScriptContent = maxHeadersLength),
        (idPrefix$asState.scriptResources[bootstrapScriptContent] = null),
        (idPrefix$asState.moduleScriptResources[bootstrapScriptContent] = null),
        (idPrefix$asResource = []),
        pushLinkImpl(idPrefix$asResource, inlineStyleWithNonce$asProps),
        onHeaders$asState.bootstrapScripts.add(idPrefix$asResource),
        bootstrapChunks.push(
          '<script src="',
          escapeTextForBrowser(maxHeadersLength),
          '"'
        ),
        externalRuntimeConfig &&
          bootstrapChunks.push(
            ' nonce="',
            escapeTextForBrowser(externalRuntimeConfig),
            '"'
          ),
        "string" === typeof nonceStyle &&
          bootstrapChunks.push(
            ' integrity="',
            escapeTextForBrowser(nonceStyle),
            '"'
          ),
        "string" === typeof inlineScriptWithNonce &&
          bootstrapChunks.push(
            ' crossorigin="',
            escapeTextForBrowser(inlineScriptWithNonce),
            '"'
          ),
        pushCompletedShellIdAttribute(bootstrapChunks, resumableState),
        bootstrapChunks.push(' async="">\x3c/script>');
  if (void 0 !== bootstrapModules)
    for (nonce = 0; nonce < bootstrapModules.length; nonce++)
      (nonceStyle = bootstrapModules[nonce]),
        (maxHeadersLength = importMap = void 0),
        (inlineScriptWithNonce$asProps = {
          rel: "modulepreload",
          fetchPriority: "low",
          nonce: externalRuntimeConfig
        }),
        "string" === typeof nonceStyle
          ? (inlineScriptWithNonce$asProps.href = bootstrapScripts = nonceStyle)
          : ((inlineScriptWithNonce$asProps.href = bootstrapScripts = nonceStyle.src),
            (inlineScriptWithNonce$asProps.integrity = maxHeadersLength =
              "string" === typeof nonceStyle.integrity
                ? nonceStyle.integrity
                : void 0),
            (inlineScriptWithNonce$asProps.crossOrigin = importMap =
              "string" === typeof nonceStyle || null == nonceStyle.crossOrigin
                ? void 0
                : "use-credentials" === nonceStyle.crossOrigin
                  ? "use-credentials"
                  : "")),
        (nonceStyle$asState = resumableState),
        (inlineStyleWithNonce$asSrc = bootstrapScripts),
        (nonceStyle$asState.scriptResources[inlineStyleWithNonce$asSrc] = null),
        (nonceStyle$asState.moduleScriptResources[inlineStyleWithNonce$asSrc] = null),
        (nonceStyle$asResource = []),
        pushLinkImpl(nonceStyle$asResource, inlineScriptWithNonce$asProps),
        onHeaders$asState.bootstrapScripts.add(nonceStyle$asResource),
        bootstrapChunks.push(
          '<script type="module" src="',
          escapeTextForBrowser(bootstrapScripts),
          '"'
        ),
        externalRuntimeConfig &&
          bootstrapChunks.push(
            ' nonce="',
            escapeTextForBrowser(externalRuntimeConfig),
            '"'
          ),
        "string" === typeof maxHeadersLength &&
          bootstrapChunks.push(
            ' integrity="',
            escapeTextForBrowser(maxHeadersLength),
            '"'
          ),
        "string" === typeof importMap &&
          bootstrapChunks.push(
            ' crossorigin="',
            escapeTextForBrowser(importMap),
            '"'
          ),
        pushCompletedShellIdAttribute(bootstrapChunks, resumableState),
        bootstrapChunks.push(' async="">\x3c/script>');
  return onHeaders$asState;
}
function createResumableState(
  identifierPrefix: FZ.PropValue,
  externalRuntimeConfig: FZ.PropValue,
  bootstrapScriptContent: FZ.BootstrapScriptContent,
  bootstrapScripts: FZ.BootstrapScripts,
  bootstrapModules: FZ.BootstrapScripts
): FZ.ResumableState {
  return {
    idPrefix: void 0 === identifierPrefix ? "" : identifierPrefix,
    nextFormID: 0,
    streamingFormat: 0,
    bootstrapScriptContent: bootstrapScriptContent,
    bootstrapScripts: bootstrapScripts,
    bootstrapModules: bootstrapModules,
    instructions: 0,
    hasBody: !1,
    hasHtml: !1,
    unknownResources: {},
    dnsResources: {},
    connectResources: { default: {}, anonymous: {}, credentials: {} },
    imageResources: {},
    styleResources: {},
    scriptResources: {},
    moduleUnknownResources: {},
    moduleScriptResources: {}
  };
}
function createPreambleState(): FZ.PreambleState {
  return { htmlChunks: null, headChunks: null, bodyChunks: null };
}
function createFormatContext(
  insertionMode: FZ.InsertionMode,
  selectedValue: FZ.SelectedValue,
  tagScope: FZ.TagScope,
  viewTransition: FZ.ViewTransitionContext | null
): FZ.FormatContext {
  return {
    insertionMode: insertionMode,
    selectedValue: selectedValue,
    tagScope: tagScope,
    viewTransition: viewTransition
  };
}
function createRootFormatContext(namespaceURI: FZ.PropValue): FZ.FormatContext {
  return createFormatContext(
    "http://www.w3.org/2000/svg" === namespaceURI
      ? 4
      : "http://www.w3.org/1998/Math/MathML" === namespaceURI
        ? 5
        : 0,
    null,
    0,
    null
  );
}
function getChildFormatContext(parentContext: FZ.FormatContext, type: string, props: FZ.Props): FZ.FormatContext {
  var subtreeScope: FZ.TagScope = parentContext.tagScope & -25;
  switch (type) {
    case "noscript":
      return createFormatContext(2, null, subtreeScope | 1, null);
    case "select":
      return createFormatContext(
        2,
        null != props.value ? props.value : props.defaultValue,
        subtreeScope,
        null
      );
    case "svg":
      return createFormatContext(4, null, subtreeScope, null);
    case "picture":
      return createFormatContext(2, null, subtreeScope | 2, null);
    case "math":
      return createFormatContext(5, null, subtreeScope, null);
    case "foreignObject":
      return createFormatContext(2, null, subtreeScope, null);
    case "table":
      return createFormatContext(6, null, subtreeScope, null);
    case "thead":
    case "tbody":
    case "tfoot":
      return createFormatContext(7, null, subtreeScope, null);
    case "colgroup":
      return createFormatContext(9, null, subtreeScope, null);
    case "tr":
      return createFormatContext(8, null, subtreeScope, null);
    case "head":
      if (2 > parentContext.insertionMode)
        return createFormatContext(3, null, subtreeScope, null);
      break;
    case "html":
      if (0 === parentContext.insertionMode)
        return createFormatContext(1, null, subtreeScope, null);
  }
  return 6 <= parentContext.insertionMode || 2 > parentContext.insertionMode
    ? createFormatContext(2, null, subtreeScope, null)
    : null !== parentContext.viewTransition ||
        parentContext.tagScope !== subtreeScope
      ? createFormatContext(
          parentContext.insertionMode,
          parentContext.selectedValue,
          subtreeScope,
          null
        )
      : parentContext;
}
function getSuspenseViewTransition(parentViewTransition: FZ.ViewTransitionContext | null): FZ.ViewTransitionContext | null {
  return null === parentViewTransition
    ? null
    : {
        update: parentViewTransition.update,
        enter: "none",
        exit: "none",
        share: parentViewTransition.update,
        parentEnter: "none",
        parentExit: "none",
        name: parentViewTransition.autoName,
        autoName: parentViewTransition.autoName,
        nameIdx: 0
      };
}
function getSuspenseFallbackFormatContext(resumableState: FZ.ResumableState, parentContext: FZ.FormatContext): FZ.FormatContext {
  parentContext.tagScope & 32 && (resumableState.instructions |= 128);
  return createFormatContext(
    parentContext.insertionMode,
    parentContext.selectedValue,
    parentContext.tagScope | 12,
    getSuspenseViewTransition(parentContext.viewTransition)
  );
}
function getSuspenseContentFormatContext(resumableState$given: FZ.ResumableState, parentContext: FZ.FormatContext): FZ.FormatContext { /*$*/var resumableState; resumableState = resumableState$given;/*$*/
  resumableState = getSuspenseViewTransition(parentContext.viewTransition);
  var subtreeScope: FZ.TagScope = parentContext.tagScope | 16;
  null !== resumableState &&
    "none" !== resumableState.share &&
    (subtreeScope |= 64);
  return createFormatContext(
    parentContext.insertionMode,
    parentContext.selectedValue,
    subtreeScope,
    resumableState
  );
}
function makeId(resumableState$given: FZ.ResumableState, treeId: string, localId: FZ.int32): string { /*$*/var resumableState; resumableState = resumableState$given;/*$*/
  resumableState = "_" + resumableState.idPrefix + "R_" + treeId;
  0 < localId && (resumableState += "H" + localId.toString(32));
  return resumableState + "_";
}
function pushTextInstance(target: FZ.Chunk[], text: string, renderState: FZ.RenderState, textEmbedded: boolean): boolean {
  if ("" === text) return textEmbedded;
  textEmbedded && target.push("\x3c!-- --\x3e");
  target.push(escapeTextForBrowser(text));
  return !0;
}
function pushSegmentFinale(target: FZ.Chunk[], renderState: FZ.RenderState, lastPushedText: boolean, textEmbedded: boolean): void {
  lastPushedText && textEmbedded && target.push("\x3c!-- --\x3e");
}
function pushViewTransitionAttributes(target: FZ.Chunk[], formatContext$given: FZ.FormatContext): void { /*$*/var formatContext; formatContext = formatContext$given;/*$*/
  formatContext = formatContext.viewTransition;
  null !== formatContext &&
    ("auto" !== formatContext.name &&
      (pushStringAttribute(
        target,
        "vt-name",
        0 === formatContext.nameIdx
          ? formatContext.name
          : formatContext.name + "_" + formatContext.nameIdx
      ),
      formatContext.nameIdx++),
    pushStringAttribute(target, "vt-update", formatContext.update),
    "none" !== formatContext.enter &&
      pushStringAttribute(target, "vt-enter", formatContext.enter),
    "none" !== formatContext.exit &&
      pushStringAttribute(target, "vt-exit", formatContext.exit),
    "none" !== formatContext.share &&
      pushStringAttribute(target, "vt-share", formatContext.share));
}
var styleNameCache: Map<string, FZ.Chunk> = new Map();
function pushStyleAttribute(target: FZ.Chunk[], style: FZ.PropValue): void { /*$*/var styleValue$asChunk: FZ.Chunk;/*$*/
  if ("object" !== typeof style)
    throw Error(
      "The `style` prop expects a mapping from style properties to values, not a string. For example, style={{marginRight: spacing + 'em'}} when using JSX."
    );
  var isFirst = !0,
    styleName: string;
  for (styleName in style)
    if (hasOwnProperty.call(style, styleName)) {
      var styleValue: FZ.PropValue = style[styleName];
      if (
        null != styleValue &&
        "boolean" !== typeof styleValue &&
        "" !== styleValue
      ) {
        if (0 === styleName.indexOf("--")) {
          var nameChunk: FZ.Chunk | undefined = escapeTextForBrowser(styleName);
          styleValue$asChunk = escapeTextForBrowser(("" + styleValue).trim());
        } else
          (nameChunk = styleNameCache.get(styleName)),
            void 0 === nameChunk &&
              ((nameChunk = escapeTextForBrowser(
                styleName
                  .replace(uppercasePattern, "-$1")
                  .toLowerCase()
                  .replace(msPattern, "-ms-")
              )),
              styleNameCache.set(styleName, nameChunk)),
            (styleValue$asChunk =
              "number" === typeof styleValue
                ? 0 === styleValue || unitlessNumbers.has(styleName)
                  ? "" + styleValue
                  : styleValue + "px"
                : escapeTextForBrowser(("" + styleValue).trim()));
        isFirst
          ? ((isFirst = !1),
            target.push(' style="', nameChunk, ":", styleValue$asChunk))
          : target.push(";", nameChunk, ":", styleValue$asChunk);
      }
    }
  isFirst || target.push('"');
}
function pushBooleanAttribute(target: FZ.Chunk[], name: string, value: FZ.PropValue): void {
  value &&
    "function" !== typeof value &&
    "symbol" !== typeof value &&
    target.push(" ", name, '=""');
}
function pushStringAttribute(target: FZ.Chunk[], name: string, value: FZ.PropValue): void {
  "function" !== typeof value &&
    "symbol" !== typeof value &&
    "boolean" !== typeof value &&
    target.push(" ", name, '="', escapeTextForBrowser(value), '"');
}
var actionJavaScriptURL = escapeTextForBrowser(
  "javascript:throw new Error('React form unexpectedly submitted.')"
);
function pushAdditionalFormField(this: FZ.Chunk[], value: FZ.PropValue, key: FZ.PropValue): void {
  this.push('<input type="hidden"');
  validateAdditionalFormField(value);
  pushStringAttribute(this, "name", key);
  pushStringAttribute(this, "value", value);
  this.push("/>");
}
function validateAdditionalFormField(value: FZ.PropValue): void {
  if ("string" !== typeof value)
    throw Error(
      "File/Blob fields are not yet supported in progressive forms. Will fallback to client hydration."
    );
}
function getCustomFormFields(resumableState$given: FZ.ResumableState, formAction: FZ.FormAction): FZ.CustomFormFields { /*$*/var resumableState; resumableState = resumableState$given;/*$*/
  if ("function" === typeof formAction.$$FORM_ACTION) {
    var id: number = resumableState.nextFormID++;
    resumableState = resumableState.idPrefix + id;
    try {
      var customFields: FZ.CustomFormFields = formAction.$$FORM_ACTION(resumableState);
      if (customFields) {
        var formData: FZ.FormDataGiven = customFields.data;
        null != formData && formData.forEach(validateAdditionalFormField);
      }
      return customFields;
    } catch (x: FZ.Thrown) {
      if ("object" === typeof x && null !== x && "function" === typeof x.then)
        throw x;
    }
  }
  return null;
}
function pushFormActionAttribute(
  target: FZ.Chunk[],
  resumableState: FZ.ResumableState,
  renderState: FZ.RenderState,
  formAction: FZ.FormAction,
  formEncType: FZ.PropValue,
  formMethod: FZ.PropValue,
  formTarget: FZ.PropValue,
  name: FZ.PropValue
): FZ.FormDataGiven {
  var formData: FZ.FormDataGiven = null;
  if ("function" === typeof formAction) {
    var customFields: FZ.CustomFormFields = getCustomFormFields(resumableState, formAction);
    null !== customFields
      ? ((name = customFields.name),
        (formAction = customFields.action || ""),
        (formEncType = customFields.encType),
        (formMethod = customFields.method),
        (formTarget = customFields.target),
        (formData = customFields.data))
      : (target.push(" ", "formAction", '="', actionJavaScriptURL, '"'),
        (formTarget = formMethod = formEncType = formAction = name = null),
        injectFormReplayingRuntime(resumableState, renderState));
  }
  null != name && pushAttribute(target, "name", name);
  null != formAction && pushAttribute(target, "formAction", formAction);
  null != formEncType && pushAttribute(target, "formEncType", formEncType);
  null != formMethod && pushAttribute(target, "formMethod", formMethod);
  null != formTarget && pushAttribute(target, "formTarget", formTarget);
  return formData;
}
function pushAttribute(target: FZ.Chunk[], name: string, value: FZ.PropValue): void {
  switch (name) {
    case "className":
      pushStringAttribute(target, "class", value);
      break;
    case "tabIndex":
      pushStringAttribute(target, "tabindex", value);
      break;
    case "dir":
    case "role":
    case "viewBox":
    case "width":
    case "height":
      pushStringAttribute(target, name, value);
      break;
    case "style":
      pushStyleAttribute(target, value);
      break;
    case "src":
    case "href":
      if ("" === value) break;
    case "action":
    case "formAction":
      if (
        null == value ||
        "function" === typeof value ||
        "symbol" === typeof value ||
        "boolean" === typeof value
      )
        break;
      value = sanitizeURL("" + value);
      target.push(" ", name, '="', escapeTextForBrowser(value), '"');
      break;
    case "defaultValue":
    case "defaultChecked":
    case "innerHTML":
    case "suppressContentEditableWarning":
    case "suppressHydrationWarning":
    case "ref":
      break;
    case "autoFocus":
    case "multiple":
    case "muted":
      pushBooleanAttribute(target, name.toLowerCase(), value);
      break;
    case "xlinkHref":
      if (
        "function" === typeof value ||
        "symbol" === typeof value ||
        "boolean" === typeof value
      )
        break;
      value = sanitizeURL("" + value);
      target.push(" ", "xlink:href", '="', escapeTextForBrowser(value), '"');
      break;
    case "contentEditable":
    case "spellCheck":
    case "draggable":
    case "value":
    case "autoReverse":
    case "externalResourcesRequired":
    case "focusable":
    case "preserveAlpha":
      "function" !== typeof value &&
        "symbol" !== typeof value &&
        target.push(" ", name, '="', escapeTextForBrowser(value), '"');
      break;
    case "inert":
    case "allowFullScreen":
    case "async":
    case "autoPlay":
    case "controls":
    case "credentialless":
    case "default":
    case "defer":
    case "disabled":
    case "disablePictureInPicture":
    case "disableRemotePlayback":
    case "formNoValidate":
    case "hidden":
    case "loop":
    case "noModule":
    case "noValidate":
    case "open":
    case "playsInline":
    case "readOnly":
    case "required":
    case "reversed":
    case "scoped":
    case "seamless":
    case "itemScope":
      value &&
        "function" !== typeof value &&
        "symbol" !== typeof value &&
        target.push(" ", name, '=""');
      break;
    case "capture":
    case "download":
      !0 === value
        ? target.push(" ", name, '=""')
        : !1 !== value &&
          "function" !== typeof value &&
          "symbol" !== typeof value &&
          target.push(" ", name, '="', escapeTextForBrowser(value), '"');
      break;
    case "cols":
    case "rows":
    case "size":
    case "span":
      "function" !== typeof value &&
        "symbol" !== typeof value &&
        !isNaN(value) &&
        1 <= value &&
        target.push(" ", name, '="', escapeTextForBrowser(value), '"');
      break;
    case "rowSpan":
    case "start":
      "function" === typeof value ||
        "symbol" === typeof value ||
        isNaN(value) ||
        target.push(" ", name, '="', escapeTextForBrowser(value), '"');
      break;
    case "xlinkActuate":
      pushStringAttribute(target, "xlink:actuate", value);
      break;
    case "xlinkArcrole":
      pushStringAttribute(target, "xlink:arcrole", value);
      break;
    case "xlinkRole":
      pushStringAttribute(target, "xlink:role", value);
      break;
    case "xlinkShow":
      pushStringAttribute(target, "xlink:show", value);
      break;
    case "xlinkTitle":
      pushStringAttribute(target, "xlink:title", value);
      break;
    case "xlinkType":
      pushStringAttribute(target, "xlink:type", value);
      break;
    case "xmlBase":
      pushStringAttribute(target, "xml:base", value);
      break;
    case "xmlLang":
      pushStringAttribute(target, "xml:lang", value);
      break;
    case "xmlSpace":
      pushStringAttribute(target, "xml:space", value);
      break;
    default:
      if (
        !(2 < name.length) ||
        ("o" !== name[0] && "O" !== name[0]) ||
        ("n" !== name[1] && "N" !== name[1])
      )
        if (((name = aliases.get(name) || name), isAttributeNameSafe(name))) {
          switch (typeof value) {
            case "function":
            case "symbol":
              return;
            case "boolean":
              var prefix$8 = name.toLowerCase().slice(0, 5);
              if ("data-" !== prefix$8 && "aria-" !== prefix$8) return;
          }
          target.push(" ", name, '="', escapeTextForBrowser(value), '"');
        }
  }
}
function pushInnerHTML(target: FZ.Chunk[], innerHTML: FZ.PropValue, children: FZ.ReactNode): void {
  if (null != innerHTML) {
    if (null != children)
      throw Error(
        "Can only set one of `children` or `props.dangerouslySetInnerHTML`."
      );
    if ("object" !== typeof innerHTML || !("__html" in innerHTML))
      throw Error(
        "`props.dangerouslySetInnerHTML` must be in the form `{__html: ...}`. Please visit https://react.dev/link/dangerously-set-inner-html for more information."
      );
    innerHTML = innerHTML.__html;
    null !== innerHTML && void 0 !== innerHTML && target.push("" + innerHTML);
  }
}
function flattenOptionChildren(children: FZ.ReactNode): string {
  var content = "";
  React.Children.forEach(children, function (child: FZ.ReactNode) {
    null != child && (content += child);
  });
  return content;
}
function injectFormReplayingRuntime(resumableState: FZ.ResumableState, renderState: FZ.RenderState): void {
  if (0 === (resumableState.instructions & 16)) {
    resumableState.instructions |= 16;
    var preamble = renderState.preamble,
      bootstrapChunks = renderState.bootstrapChunks;
    (preamble.htmlChunks || preamble.headChunks) && 0 === bootstrapChunks.length
      ? (bootstrapChunks.push(renderState.startInlineScript),
        pushCompletedShellIdAttribute(bootstrapChunks, resumableState),
        bootstrapChunks.push(
          ">",
          'addEventListener("submit",function(a){if(!a.defaultPrevented){var b=a.target,d=a.submitter,c=b.action,e=d;if(d){var f=d.getAttribute("formAction");null!=f&&(c=f,e=null)}"javascript:throw new Error(\'React form unexpectedly submitted.\')"===c&&(a.preventDefault(),a=new FormData(b,e),c=b.ownerDocument||b,(c.$$reactFormReplay=c.$$reactFormReplay||[]).push(b,d,a))}});',
          "\x3c/script>"
        ))
      : bootstrapChunks.unshift(
          renderState.startInlineScript,
          ">",
          'addEventListener("submit",function(a){if(!a.defaultPrevented){var b=a.target,d=a.submitter,c=b.action,e=d;if(d){var f=d.getAttribute("formAction");null!=f&&(c=f,e=null)}"javascript:throw new Error(\'React form unexpectedly submitted.\')"===c&&(a.preventDefault(),a=new FormData(b,e),c=b.ownerDocument||b,(c.$$reactFormReplay=c.$$reactFormReplay||[]).push(b,d,a))}});',
          "\x3c/script>"
        );
  }
}
function pushLinkImpl(target: FZ.Chunk[], props: FZ.Props): null {
  target.push(startChunkForTag("link"));
  for (var propKey in props)
    if (hasOwnProperty.call(props, propKey)) {
      var propValue: FZ.PropValue = props[propKey];
      if (null != propValue)
        switch (propKey) {
          case "children":
          case "dangerouslySetInnerHTML":
            throw Error(
              "link is a self-closing tag and must neither have `children` nor use `dangerouslySetInnerHTML`."
            );
          default:
            pushAttribute(target, propKey, propValue);
        }
    }
  target.push("/>");
  return null;
}
var styleRegex = /(<\/|<)(s)(tyle)/gi;
function styleReplacer(match: string, prefix: string, s: string, suffix: string): string {
  return "" + prefix + ("s" === s ? "\\73 " : "\\53 ") + suffix;
}
function pushSelfClosing(target: FZ.Chunk[], props: FZ.Props, tag: string, formatContext: FZ.FormatContext): null {
  target.push(startChunkForTag(tag));
  for (var propKey in props)
    if (hasOwnProperty.call(props, propKey)) {
      var propValue = props[propKey];
      if (null != propValue)
        switch (propKey) {
          case "children":
          case "dangerouslySetInnerHTML":
            throw Error(
              tag +
                " is a self-closing tag and must neither have `children` nor use `dangerouslySetInnerHTML`."
            );
          default:
            pushAttribute(target, propKey, propValue);
        }
    }
  pushViewTransitionAttributes(target, formatContext);
  target.push("/>");
  return null;
}
function pushTitleImpl(target: FZ.Chunk[], props: FZ.Props): null {
  target.push(startChunkForTag("title"));
  var children: FZ.ReactNode = null,
    innerHTML: FZ.PropValue = null,
    propKey: string;
  for (propKey in props)
    if (hasOwnProperty.call(props, propKey)) {
      var propValue = props[propKey];
      if (null != propValue)
        switch (propKey) {
          case "children":
            children = propValue;
            break;
          case "dangerouslySetInnerHTML":
            innerHTML = propValue;
            break;
          default:
            pushAttribute(target, propKey, propValue);
        }
    }
  target.push(">");
  props = Array.isArray(children)
    ? 2 > children.length
      ? children[0]
      : null
    : children;
  "function" !== typeof props &&
    "symbol" !== typeof props &&
    null !== props &&
    void 0 !== props &&
    target.push(escapeTextForBrowser("" + props));
  pushInnerHTML(target, innerHTML, children);
  target.push(endChunkForTag("title"));
  return null;
}
function pushScriptImpl(target: FZ.Chunk[], props: FZ.Props): null {
  target.push(startChunkForTag("script"));
  var children: FZ.ReactNode = null,
    innerHTML: FZ.PropValue = null,
    propKey: string;
  for (propKey in props)
    if (hasOwnProperty.call(props, propKey)) {
      var propValue = props[propKey];
      if (null != propValue)
        switch (propKey) {
          case "children":
            children = propValue;
            break;
          case "dangerouslySetInnerHTML":
            innerHTML = propValue;
            break;
          default:
            pushAttribute(target, propKey, propValue);
        }
    }
  target.push(">");
  pushInnerHTML(target, innerHTML, children);
  "string" === typeof children &&
    target.push(("" + children).replace(scriptRegex, scriptReplacer));
  target.push(endChunkForTag("script"));
  return null;
}
function pushStartSingletonElement(target: FZ.Chunk[], props: FZ.Props, tag$given: string, formatContext: FZ.FormatContext): FZ.ReactNode { /*$*/var tag; tag = tag$given;/*$*/
  target.push(startChunkForTag(tag));
  var innerHTML: FZ.PropValue = (tag = null),
    propKey: string;
  for (propKey in props)
    if (hasOwnProperty.call(props, propKey)) {
      var propValue = props[propKey];
      if (null != propValue)
        switch (propKey) {
          case "children":
            tag = propValue;
            break;
          case "dangerouslySetInnerHTML":
            innerHTML = propValue;
            break;
          default:
            pushAttribute(target, propKey, propValue);
        }
    }
  pushViewTransitionAttributes(target, formatContext);
  target.push(">");
  pushInnerHTML(target, innerHTML, tag);
  return tag;
}
function pushStartGenericElement(target: FZ.Chunk[], props: FZ.Props, tag$given: string, formatContext: FZ.FormatContext): FZ.ReactNode { /*$*/var tag; tag = tag$given;/*$*/
  target.push(startChunkForTag(tag));
  var innerHTML: FZ.PropValue = (tag = null),
    propKey: string;
  for (propKey in props)
    if (hasOwnProperty.call(props, propKey)) {
      var propValue = props[propKey];
      if (null != propValue)
        switch (propKey) {
          case "children":
            tag = propValue;
            break;
          case "dangerouslySetInnerHTML":
            innerHTML = propValue;
            break;
          default:
            pushAttribute(target, propKey, propValue);
        }
    }
  pushViewTransitionAttributes(target, formatContext);
  target.push(">");
  pushInnerHTML(target, innerHTML, tag);
  return "string" === typeof tag
    ? (target.push(escapeTextForBrowser(tag)), null)
    : tag;
}
var VALID_TAG_REGEX = /^[a-zA-Z][a-zA-Z:_\.\-\d]*$/,
  validatedTagCache: Map<string, FZ.Chunk> = new Map();
function startChunkForTag(tag: string): FZ.Chunk {
  var tagStartChunk = validatedTagCache.get(tag);
  if (void 0 === tagStartChunk) {
    if (!VALID_TAG_REGEX.test(tag)) throw Error("Invalid tag: " + tag);
    tagStartChunk = "<" + tag;
    validatedTagCache.set(tag, tagStartChunk);
  }
  return tagStartChunk;
}
function pushStartInstance(
  target$jscomp$0: FZ.Chunk[],
  type: string,
  props: FZ.Props,
  resumableState: FZ.ResumableState,
  renderState: FZ.RenderState,
  preambleState: FZ.PreambleState | null,
  hoistableState: FZ.HoistableState | null,
  formatContext: FZ.FormatContext,
  textEmbedded: boolean
): FZ.ReactNode {
  switch (type) {
    case "div":
    case "span":
    case "svg":
    case "path":
      break;
    case "a":
      target$jscomp$0.push(startChunkForTag("a"));
      var children: FZ.ReactNode = null,
        innerHTML: FZ.PropValue = null,
        propKey: string;
      for (propKey in props)
        if (hasOwnProperty.call(props, propKey)) {
          var propValue = props[propKey];
          if (null != propValue)
            switch (propKey) {
              case "children":
                children = propValue;
                break;
              case "dangerouslySetInnerHTML":
                innerHTML = propValue;
                break;
              case "href":
                "" === propValue
                  ? pushStringAttribute(target$jscomp$0, "href", "")
                  : pushAttribute(target$jscomp$0, propKey, propValue);
                break;
              default:
                pushAttribute(target$jscomp$0, propKey, propValue);
            }
        }
      pushViewTransitionAttributes(target$jscomp$0, formatContext);
      target$jscomp$0.push(">");
      pushInnerHTML(target$jscomp$0, innerHTML, children);
      if ("string" === typeof children) {
        target$jscomp$0.push(escapeTextForBrowser(children));
        var JSCompiler_inline_result: FZ.ReactNode = null;
      } else JSCompiler_inline_result = children;
      return JSCompiler_inline_result;
    case "g":
    case "p":
    case "li":
      break;
    case "select":
      target$jscomp$0.push(startChunkForTag("select"));
      var children$jscomp$0: FZ.ReactNode = null,
        innerHTML$jscomp$0: FZ.PropValue = null,
        propKey$jscomp$0: string;
      for (propKey$jscomp$0 in props)
        if (hasOwnProperty.call(props, propKey$jscomp$0)) {
          var propValue$jscomp$0 = props[propKey$jscomp$0];
          if (null != propValue$jscomp$0)
            switch (propKey$jscomp$0) {
              case "children":
                children$jscomp$0 = propValue$jscomp$0;
                break;
              case "dangerouslySetInnerHTML":
                innerHTML$jscomp$0 = propValue$jscomp$0;
                break;
              case "defaultValue":
              case "value":
                break;
              default:
                pushAttribute(
                  target$jscomp$0,
                  propKey$jscomp$0,
                  propValue$jscomp$0
                );
            }
        }
      pushViewTransitionAttributes(target$jscomp$0, formatContext);
      target$jscomp$0.push(">");
      pushInnerHTML(target$jscomp$0, innerHTML$jscomp$0, children$jscomp$0);
      return children$jscomp$0;
    case "option":
      var selectedValue: FZ.SelectedValue = formatContext.selectedValue;
      target$jscomp$0.push(startChunkForTag("option"));
      var children$jscomp$1: FZ.ReactNode = null,
        value: FZ.PropValue = null,
        selected: FZ.PropValue = null,
        innerHTML$jscomp$1: FZ.PropValue = null,
        propKey$jscomp$1: string;
      for (propKey$jscomp$1 in props)
        if (hasOwnProperty.call(props, propKey$jscomp$1)) {
          var propValue$jscomp$1 = props[propKey$jscomp$1];
          if (null != propValue$jscomp$1)
            switch (propKey$jscomp$1) {
              case "children":
                children$jscomp$1 = propValue$jscomp$1;
                break;
              case "selected":
                selected = propValue$jscomp$1;
                break;
              case "dangerouslySetInnerHTML":
                innerHTML$jscomp$1 = propValue$jscomp$1;
                break;
              case "value":
                value = propValue$jscomp$1;
              default:
                pushAttribute(
                  target$jscomp$0,
                  propKey$jscomp$1,
                  propValue$jscomp$1
                );
            }
        }
      if (null != selectedValue) {
        var stringValue: string =
          null !== value
            ? "" + value
            : flattenOptionChildren(children$jscomp$1);
        if (isArrayImpl(selectedValue))
          for (var i = 0; i < selectedValue.length; i++) {
            if ("" + selectedValue[i] === stringValue) {
              target$jscomp$0.push(' selected=""');
              break;
            }
          }
        else
          "" + selectedValue === stringValue &&
            target$jscomp$0.push(' selected=""');
      } else selected && target$jscomp$0.push(' selected=""');
      target$jscomp$0.push(">");
      pushInnerHTML(target$jscomp$0, innerHTML$jscomp$1, children$jscomp$1);
      return children$jscomp$1;
    case "textarea":
      target$jscomp$0.push(startChunkForTag("textarea"));
      var value$jscomp$0: FZ.PropValue = null,
        defaultValue: FZ.PropValue = null,
        children$jscomp$2: FZ.ReactNode = null,
        propKey$jscomp$2: string;
      for (propKey$jscomp$2 in props)
        if (hasOwnProperty.call(props, propKey$jscomp$2)) {
          var propValue$jscomp$2 = props[propKey$jscomp$2];
          if (null != propValue$jscomp$2)
            switch (propKey$jscomp$2) {
              case "children":
                children$jscomp$2 = propValue$jscomp$2;
                break;
              case "value":
                value$jscomp$0 = propValue$jscomp$2;
                break;
              case "defaultValue":
                defaultValue = propValue$jscomp$2;
                break;
              case "dangerouslySetInnerHTML":
                throw Error(
                  "`dangerouslySetInnerHTML` does not make sense on <textarea>."
                );
              default:
                pushAttribute(
                  target$jscomp$0,
                  propKey$jscomp$2,
                  propValue$jscomp$2
                );
            }
        }
      null === value$jscomp$0 &&
        null !== defaultValue &&
        (value$jscomp$0 = defaultValue);
      pushViewTransitionAttributes(target$jscomp$0, formatContext);
      target$jscomp$0.push(">");
      if (null != children$jscomp$2) {
        if (null != value$jscomp$0)
          throw Error(
            "If you supply `defaultValue` on a <textarea>, do not pass children."
          );
        if (isArrayImpl(children$jscomp$2)) {
          if (1 < children$jscomp$2.length)
            throw Error("<textarea> can only have at most one child.");
          value$jscomp$0 = "" + children$jscomp$2[0];
        }
        value$jscomp$0 = "" + children$jscomp$2;
      }
      "string" === typeof value$jscomp$0 &&
        "\n" === value$jscomp$0[0] &&
        target$jscomp$0.push("\n");
      null !== value$jscomp$0 &&
        target$jscomp$0.push(escapeTextForBrowser("" + value$jscomp$0));
      return null;
    case "input":
      target$jscomp$0.push(startChunkForTag("input"));
      var name: FZ.PropValue = null,
        formAction: FZ.FormAction = null,
        formEncType: FZ.PropValue = null,
        formMethod: FZ.PropValue = null,
        formTarget: FZ.PropValue = null,
        value$jscomp$1: FZ.PropValue = null,
        defaultValue$jscomp$0: FZ.PropValue = null,
        checked: FZ.PropValue = null,
        defaultChecked: FZ.PropValue = null,
        propKey$jscomp$3: string;
      for (propKey$jscomp$3 in props)
        if (hasOwnProperty.call(props, propKey$jscomp$3)) {
          var propValue$jscomp$3 = props[propKey$jscomp$3];
          if (null != propValue$jscomp$3)
            switch (propKey$jscomp$3) {
              case "children":
              case "dangerouslySetInnerHTML":
                throw Error(
                  "input is a self-closing tag and must neither have `children` nor use `dangerouslySetInnerHTML`."
                );
              case "name":
                name = propValue$jscomp$3;
                break;
              case "formAction":
                formAction = propValue$jscomp$3;
                break;
              case "formEncType":
                formEncType = propValue$jscomp$3;
                break;
              case "formMethod":
                formMethod = propValue$jscomp$3;
                break;
              case "formTarget":
                formTarget = propValue$jscomp$3;
                break;
              case "defaultChecked":
                defaultChecked = propValue$jscomp$3;
                break;
              case "defaultValue":
                defaultValue$jscomp$0 = propValue$jscomp$3;
                break;
              case "checked":
                checked = propValue$jscomp$3;
                break;
              case "value":
                value$jscomp$1 = propValue$jscomp$3;
                break;
              default:
                pushAttribute(
                  target$jscomp$0,
                  propKey$jscomp$3,
                  propValue$jscomp$3
                );
            }
        }
      var formData: FZ.FormDataGiven = pushFormActionAttribute(
        target$jscomp$0,
        resumableState,
        renderState,
        formAction,
        formEncType,
        formMethod,
        formTarget,
        name
      );
      null !== checked
        ? pushBooleanAttribute(target$jscomp$0, "checked", checked)
        : null !== defaultChecked &&
          pushBooleanAttribute(target$jscomp$0, "checked", defaultChecked);
      null !== value$jscomp$1
        ? pushAttribute(target$jscomp$0, "value", value$jscomp$1)
        : null !== defaultValue$jscomp$0 &&
          pushAttribute(target$jscomp$0, "value", defaultValue$jscomp$0);
      pushViewTransitionAttributes(target$jscomp$0, formatContext);
      target$jscomp$0.push("/>");
      null != formData &&
        formData.forEach(pushAdditionalFormField, target$jscomp$0);
      return null;
    case "button":
      target$jscomp$0.push(startChunkForTag("button"));
      var children$jscomp$3: FZ.ReactNode = null,
        innerHTML$jscomp$2: FZ.PropValue = null,
        name$jscomp$0: FZ.PropValue = null,
        formAction$jscomp$0: FZ.FormAction = null,
        formEncType$jscomp$0: FZ.PropValue = null,
        formMethod$jscomp$0: FZ.PropValue = null,
        formTarget$jscomp$0: FZ.PropValue = null,
        propKey$jscomp$4: string;
      for (propKey$jscomp$4 in props)
        if (hasOwnProperty.call(props, propKey$jscomp$4)) {
          var propValue$jscomp$4 = props[propKey$jscomp$4];
          if (null != propValue$jscomp$4)
            switch (propKey$jscomp$4) {
              case "children":
                children$jscomp$3 = propValue$jscomp$4;
                break;
              case "dangerouslySetInnerHTML":
                innerHTML$jscomp$2 = propValue$jscomp$4;
                break;
              case "name":
                name$jscomp$0 = propValue$jscomp$4;
                break;
              case "formAction":
                formAction$jscomp$0 = propValue$jscomp$4;
                break;
              case "formEncType":
                formEncType$jscomp$0 = propValue$jscomp$4;
                break;
              case "formMethod":
                formMethod$jscomp$0 = propValue$jscomp$4;
                break;
              case "formTarget":
                formTarget$jscomp$0 = propValue$jscomp$4;
                break;
              default:
                pushAttribute(
                  target$jscomp$0,
                  propKey$jscomp$4,
                  propValue$jscomp$4
                );
            }
        }
      var formData$jscomp$0: FZ.FormDataGiven = pushFormActionAttribute(
        target$jscomp$0,
        resumableState,
        renderState,
        formAction$jscomp$0,
        formEncType$jscomp$0,
        formMethod$jscomp$0,
        formTarget$jscomp$0,
        name$jscomp$0
      );
      pushViewTransitionAttributes(target$jscomp$0, formatContext);
      target$jscomp$0.push(">");
      null != formData$jscomp$0 &&
        formData$jscomp$0.forEach(pushAdditionalFormField, target$jscomp$0);
      pushInnerHTML(target$jscomp$0, innerHTML$jscomp$2, children$jscomp$3);
      if ("string" === typeof children$jscomp$3) {
        target$jscomp$0.push(escapeTextForBrowser(children$jscomp$3));
        var JSCompiler_inline_result$jscomp$0: FZ.ReactNode = null;
      } else JSCompiler_inline_result$jscomp$0 = children$jscomp$3;
      return JSCompiler_inline_result$jscomp$0;
    case "form":
      target$jscomp$0.push(startChunkForTag("form"));
      var children$jscomp$4: FZ.ReactNode = null,
        innerHTML$jscomp$3: FZ.PropValue = null,
        formAction$jscomp$1: FZ.FormAction = null,
        formEncType$jscomp$1: FZ.PropValue = null,
        formMethod$jscomp$1: FZ.PropValue = null,
        formTarget$jscomp$1: FZ.PropValue = null,
        propKey$jscomp$5: string;
      for (propKey$jscomp$5 in props)
        if (hasOwnProperty.call(props, propKey$jscomp$5)) {
          var propValue$jscomp$5 = props[propKey$jscomp$5];
          if (null != propValue$jscomp$5)
            switch (propKey$jscomp$5) {
              case "children":
                children$jscomp$4 = propValue$jscomp$5;
                break;
              case "dangerouslySetInnerHTML":
                innerHTML$jscomp$3 = propValue$jscomp$5;
                break;
              case "action":
                formAction$jscomp$1 = propValue$jscomp$5;
                break;
              case "encType":
                formEncType$jscomp$1 = propValue$jscomp$5;
                break;
              case "method":
                formMethod$jscomp$1 = propValue$jscomp$5;
                break;
              case "target":
                formTarget$jscomp$1 = propValue$jscomp$5;
                break;
              default:
                pushAttribute(
                  target$jscomp$0,
                  propKey$jscomp$5,
                  propValue$jscomp$5
                );
            }
        }
      var formData$jscomp$1: FZ.FormDataGiven = null,
        formActionName: FZ.PropValue = null;
      if ("function" === typeof formAction$jscomp$1) {
        var customFields: FZ.CustomFormFields = getCustomFormFields(
          resumableState,
          formAction$jscomp$1
        );
        null !== customFields
          ? ((formAction$jscomp$1 = customFields.action || ""),
            (formEncType$jscomp$1 = customFields.encType),
            (formMethod$jscomp$1 = customFields.method),
            (formTarget$jscomp$1 = customFields.target),
            (formData$jscomp$1 = customFields.data),
            (formActionName = customFields.name))
          : (target$jscomp$0.push(
              " ",
              "action",
              '="',
              actionJavaScriptURL,
              '"'
            ),
            (formTarget$jscomp$1 =
              formMethod$jscomp$1 =
              formEncType$jscomp$1 =
              formAction$jscomp$1 =
                null),
            injectFormReplayingRuntime(resumableState, renderState));
      }
      null != formAction$jscomp$1 &&
        pushAttribute(target$jscomp$0, "action", formAction$jscomp$1);
      null != formEncType$jscomp$1 &&
        pushAttribute(target$jscomp$0, "encType", formEncType$jscomp$1);
      null != formMethod$jscomp$1 &&
        pushAttribute(target$jscomp$0, "method", formMethod$jscomp$1);
      null != formTarget$jscomp$1 &&
        pushAttribute(target$jscomp$0, "target", formTarget$jscomp$1);
      pushViewTransitionAttributes(target$jscomp$0, formatContext);
      target$jscomp$0.push(">");
      null !== formActionName &&
        (target$jscomp$0.push('<input type="hidden"'),
        pushStringAttribute(target$jscomp$0, "name", formActionName),
        target$jscomp$0.push("/>"),
        null != formData$jscomp$1 &&
          formData$jscomp$1.forEach(pushAdditionalFormField, target$jscomp$0));
      pushInnerHTML(target$jscomp$0, innerHTML$jscomp$3, children$jscomp$4);
      if ("string" === typeof children$jscomp$4) {
        target$jscomp$0.push(escapeTextForBrowser(children$jscomp$4));
        var JSCompiler_inline_result$jscomp$1: FZ.ReactNode = null;
      } else JSCompiler_inline_result$jscomp$1 = children$jscomp$4;
      return JSCompiler_inline_result$jscomp$1;
    case "menuitem":
      target$jscomp$0.push(startChunkForTag("menuitem"));
      for (var propKey$jscomp$6 in props)
        if (hasOwnProperty.call(props, propKey$jscomp$6)) {
          var propValue$jscomp$6 = props[propKey$jscomp$6];
          if (null != propValue$jscomp$6)
            switch (propKey$jscomp$6) {
              case "children":
              case "dangerouslySetInnerHTML":
                throw Error(
                  "menuitems cannot have `children` nor `dangerouslySetInnerHTML`."
                );
              default:
                pushAttribute(
                  target$jscomp$0,
                  propKey$jscomp$6,
                  propValue$jscomp$6
                );
            }
        }
      pushViewTransitionAttributes(target$jscomp$0, formatContext);
      target$jscomp$0.push(">");
      return null;
    case "object":
      target$jscomp$0.push(startChunkForTag("object"));
      var children$jscomp$5: FZ.ReactNode = null,
        innerHTML$jscomp$4: FZ.PropValue = null,
        propKey$jscomp$7: string;
      for (propKey$jscomp$7 in props)
        if (hasOwnProperty.call(props, propKey$jscomp$7)) {
          var propValue$jscomp$7 = props[propKey$jscomp$7];
          if (null != propValue$jscomp$7)
            switch (propKey$jscomp$7) {
              case "children":
                children$jscomp$5 = propValue$jscomp$7;
                break;
              case "dangerouslySetInnerHTML":
                innerHTML$jscomp$4 = propValue$jscomp$7;
                break;
              case "data":
                var sanitizedValue: string = sanitizeURL("" + propValue$jscomp$7);
                if ("" === sanitizedValue) break;
                target$jscomp$0.push(
                  " ",
                  "data",
                  '="',
                  escapeTextForBrowser(sanitizedValue),
                  '"'
                );
                break;
              default:
                pushAttribute(
                  target$jscomp$0,
                  propKey$jscomp$7,
                  propValue$jscomp$7
                );
            }
        }
      pushViewTransitionAttributes(target$jscomp$0, formatContext);
      target$jscomp$0.push(">");
      pushInnerHTML(target$jscomp$0, innerHTML$jscomp$4, children$jscomp$5);
      if ("string" === typeof children$jscomp$5) {
        target$jscomp$0.push(escapeTextForBrowser(children$jscomp$5));
        var JSCompiler_inline_result$jscomp$2: FZ.ReactNode = null;
      } else JSCompiler_inline_result$jscomp$2 = children$jscomp$5;
      return JSCompiler_inline_result$jscomp$2;
    case "title":
      var noscriptTagInScope: FZ.TagScope = formatContext.tagScope & 1,
        isFallback: FZ.TagScope = formatContext.tagScope & 4;
      if (
        4 === formatContext.insertionMode ||
        noscriptTagInScope ||
        null != props.itemProp
      )
        var JSCompiler_inline_result$jscomp$3: null | undefined = pushTitleImpl(
          target$jscomp$0,
          props
        );
      else
        isFallback
          ? (JSCompiler_inline_result$jscomp$3 = null)
          : (pushTitleImpl(renderState.hoistableChunks, props),
            (JSCompiler_inline_result$jscomp$3 = void 0));
      return JSCompiler_inline_result$jscomp$3;
    case "link":
      var noscriptTagInScope$jscomp$0: FZ.TagScope = formatContext.tagScope & 1,
        isFallback$jscomp$0: FZ.TagScope = formatContext.tagScope & 4,
        rel: FZ.PropValue = props.rel,
        href: FZ.PropValue = props.href,
        precedence: FZ.PropValue = props.precedence;
      if (
        4 === formatContext.insertionMode ||
        noscriptTagInScope$jscomp$0 ||
        null != props.itemProp ||
        "string" !== typeof rel ||
        "string" !== typeof href ||
        "" === href
      ) {
        pushLinkImpl(target$jscomp$0, props);
        var JSCompiler_inline_result$jscomp$4: null = null;
      } else if ("stylesheet" === props.rel)
        if (
          "string" !== typeof precedence ||
          null != props.disabled ||
          props.onLoad ||
          props.onError
        )
          JSCompiler_inline_result$jscomp$4 = pushLinkImpl(
            target$jscomp$0,
            props
          );
        else {
          var styleQueue: FZ.StyleQueue | undefined = renderState.styles.get(precedence),
            resourceState: FZ.PreloadState | null | undefined = resumableState.styleResources.hasOwnProperty(href)
              ? resumableState.styleResources[href]
              : void 0;
          if (null !== resourceState) {
            resumableState.styleResources[href] = null;
            styleQueue ||
              ((styleQueue = {
                precedence: escapeTextForBrowser(precedence),
                rules: [],
                hrefs: [],
                sheets: new Map()
              }),
              renderState.styles.set(precedence, styleQueue));
            var resource: FZ.StylesheetResource = {
              state: 0,
              props: assign({}, props, {
                "data-precedence": props.precedence,
                precedence: null
              })
            };
            if (resourceState) {
              2 === resourceState.length &&
                adoptPreloadCredentials(resource.props, resourceState);
              var preloadResource: FZ.Resource | undefined = renderState.preloads.stylesheets.get(href);
              preloadResource && 0 < preloadResource.length
                ? (preloadResource.length = 0)
                : (resource.state = 1);
            }
            styleQueue.sheets.set(href, resource);
            hoistableState && hoistableState.stylesheets.add(resource);
          } else if (styleQueue) {
            var resource$9: FZ.StylesheetResource | undefined = styleQueue.sheets.get(href);
            resource$9 &&
              hoistableState &&
              hoistableState.stylesheets.add(resource$9);
          }
          textEmbedded && target$jscomp$0.push("\x3c!-- --\x3e");
          JSCompiler_inline_result$jscomp$4 = null;
        }
      else
        props.onLoad || props.onError
          ? (JSCompiler_inline_result$jscomp$4 = pushLinkImpl(
              target$jscomp$0,
              props
            ))
          : (textEmbedded && target$jscomp$0.push("\x3c!-- --\x3e"),
            (JSCompiler_inline_result$jscomp$4 = isFallback$jscomp$0
              ? null
              : pushLinkImpl(renderState.hoistableChunks, props)));
      return JSCompiler_inline_result$jscomp$4;
    case "script":
      var noscriptTagInScope$jscomp$1: FZ.TagScope = formatContext.tagScope & 1,
        asyncProp: FZ.PropValue = props.async;
      if (
        "string" !== typeof props.src ||
        !props.src ||
        !asyncProp ||
        "function" === typeof asyncProp ||
        "symbol" === typeof asyncProp ||
        props.onLoad ||
        props.onError ||
        4 === formatContext.insertionMode ||
        noscriptTagInScope$jscomp$1 ||
        null != props.itemProp
      )
        var JSCompiler_inline_result$jscomp$5: null = pushScriptImpl(
          target$jscomp$0,
          props
        );
      else {
        var key: string = props.src;
        if ("module" === props.type) {
          var resources: FZ.ResourceDict = resumableState.moduleScriptResources;
          var preloads: Map<string, FZ.Resource> = renderState.preloads.moduleScripts;
        } else
          (resources = resumableState.scriptResources),
            (preloads = renderState.preloads.scripts);
        var resourceState$jscomp$0: FZ.PreloadState | null | undefined = resources.hasOwnProperty(key)
          ? resources[key]
          : void 0;
        if (null !== resourceState$jscomp$0) {
          resources[key] = null;
          var scriptProps: FZ.Props = props;
          if (resourceState$jscomp$0) {
            2 === resourceState$jscomp$0.length &&
              ((scriptProps = assign({}, props)),
              adoptPreloadCredentials(scriptProps, resourceState$jscomp$0));
            var preloadResource$jscomp$0: FZ.Resource | undefined = preloads.get(key);
            preloadResource$jscomp$0 && (preloadResource$jscomp$0.length = 0);
          }
          var resource$jscomp$0: FZ.Resource = [];
          renderState.scripts.add(resource$jscomp$0);
          pushScriptImpl(resource$jscomp$0, scriptProps);
        }
        textEmbedded && target$jscomp$0.push("\x3c!-- --\x3e");
        JSCompiler_inline_result$jscomp$5 = null;
      }
      return JSCompiler_inline_result$jscomp$5;
    case "style":
      var noscriptTagInScope$jscomp$2: FZ.TagScope = formatContext.tagScope & 1,
        precedence$jscomp$0: FZ.PropValue = props.precedence,
        href$jscomp$0: FZ.PropValue = props.href,
        nonce: FZ.Nonce = props.nonce;
      if (
        4 === formatContext.insertionMode ||
        noscriptTagInScope$jscomp$2 ||
        null != props.itemProp ||
        "string" !== typeof precedence$jscomp$0 ||
        "string" !== typeof href$jscomp$0 ||
        "" === href$jscomp$0
      ) {
        target$jscomp$0.push(startChunkForTag("style"));
        var children$jscomp$6: FZ.ReactNode = null,
          innerHTML$jscomp$5: FZ.PropValue = null,
          propKey$jscomp$8: string;
        for (propKey$jscomp$8 in props)
          if (hasOwnProperty.call(props, propKey$jscomp$8)) {
            var propValue$jscomp$8 = props[propKey$jscomp$8];
            if (null != propValue$jscomp$8)
              switch (propKey$jscomp$8) {
                case "children":
                  children$jscomp$6 = propValue$jscomp$8;
                  break;
                case "dangerouslySetInnerHTML":
                  innerHTML$jscomp$5 = propValue$jscomp$8;
                  break;
                default:
                  pushAttribute(
                    target$jscomp$0,
                    propKey$jscomp$8,
                    propValue$jscomp$8
                  );
              }
          }
        target$jscomp$0.push(">");
        var child: FZ.ReactNode = Array.isArray(children$jscomp$6)
          ? 2 > children$jscomp$6.length
            ? children$jscomp$6[0]
            : null
          : children$jscomp$6;
        "function" !== typeof child &&
          "symbol" !== typeof child &&
          null !== child &&
          void 0 !== child &&
          target$jscomp$0.push(("" + child).replace(styleRegex, styleReplacer));
        pushInnerHTML(target$jscomp$0, innerHTML$jscomp$5, children$jscomp$6);
        target$jscomp$0.push(endChunkForTag("style"));
        var JSCompiler_inline_result$jscomp$6: null | undefined = null;
      } else {
        var styleQueue$jscomp$0: FZ.StyleQueue | undefined = renderState.styles.get(precedence$jscomp$0);
        if (
          null !==
          (resumableState.styleResources.hasOwnProperty(href$jscomp$0)
            ? resumableState.styleResources[href$jscomp$0]
            : void 0)
        ) {
          resumableState.styleResources[href$jscomp$0] = null;
          styleQueue$jscomp$0 ||
            ((styleQueue$jscomp$0 = {
              precedence: escapeTextForBrowser(precedence$jscomp$0),
              rules: [],
              hrefs: [],
              sheets: new Map()
            }),
            renderState.styles.set(precedence$jscomp$0, styleQueue$jscomp$0));
          var nonceStyle: FZ.Nonce = renderState.nonce.style;
          if (!nonceStyle || nonceStyle === nonce) {
            styleQueue$jscomp$0.hrefs.push(escapeTextForBrowser(href$jscomp$0));
            var target: FZ.Chunk[] = styleQueue$jscomp$0.rules,
              children$jscomp$7: FZ.ReactNode = null,
              innerHTML$jscomp$6: FZ.PropValue = null,
              propKey$jscomp$9: string;
            for (propKey$jscomp$9 in props)
              if (hasOwnProperty.call(props, propKey$jscomp$9)) {
                var propValue$jscomp$9 = props[propKey$jscomp$9];
                if (null != propValue$jscomp$9)
                  switch (propKey$jscomp$9) {
                    case "children":
                      children$jscomp$7 = propValue$jscomp$9;
                      break;
                    case "dangerouslySetInnerHTML":
                      innerHTML$jscomp$6 = propValue$jscomp$9;
                  }
              }
            var child$jscomp$0: FZ.ReactNode = Array.isArray(children$jscomp$7)
              ? 2 > children$jscomp$7.length
                ? children$jscomp$7[0]
                : null
              : children$jscomp$7;
            "function" !== typeof child$jscomp$0 &&
              "symbol" !== typeof child$jscomp$0 &&
              null !== child$jscomp$0 &&
              void 0 !== child$jscomp$0 &&
              target.push(
                ("" + child$jscomp$0).replace(styleRegex, styleReplacer)
              );
            pushInnerHTML(target, innerHTML$jscomp$6, children$jscomp$7);
          }
        }
        styleQueue$jscomp$0 &&
          hoistableState &&
          hoistableState.styles.add(styleQueue$jscomp$0);
        textEmbedded && target$jscomp$0.push("\x3c!-- --\x3e");
        JSCompiler_inline_result$jscomp$6 = void 0;
      }
      return JSCompiler_inline_result$jscomp$6;
    case "meta":
      var noscriptTagInScope$jscomp$3: FZ.TagScope = formatContext.tagScope & 1,
        isFallback$jscomp$1: FZ.TagScope = formatContext.tagScope & 4;
      if (
        4 === formatContext.insertionMode ||
        noscriptTagInScope$jscomp$3 ||
        null != props.itemProp
      )
        var JSCompiler_inline_result$jscomp$7: null = pushSelfClosing(
          target$jscomp$0,
          props,
          "meta",
          formatContext
        );
      else
        textEmbedded && target$jscomp$0.push("\x3c!-- --\x3e"),
          (JSCompiler_inline_result$jscomp$7 = isFallback$jscomp$1
            ? null
            : "string" === typeof props.charSet
              ? pushSelfClosing(
                  renderState.charsetChunks,
                  props,
                  "meta",
                  formatContext
                )
              : "viewport" === props.name
                ? pushSelfClosing(
                    renderState.viewportChunks,
                    props,
                    "meta",
                    formatContext
                  )
                : pushSelfClosing(
                    renderState.hoistableChunks,
                    props,
                    "meta",
                    formatContext
                  ));
      return JSCompiler_inline_result$jscomp$7;
    case "listing":
    case "pre":
      target$jscomp$0.push(startChunkForTag(type));
      var children$jscomp$8: FZ.ReactNode = null,
        innerHTML$jscomp$7: FZ.PropValue = null,
        propKey$jscomp$10: string;
      for (propKey$jscomp$10 in props)
        if (hasOwnProperty.call(props, propKey$jscomp$10)) {
          var propValue$jscomp$10 = props[propKey$jscomp$10];
          if (null != propValue$jscomp$10)
            switch (propKey$jscomp$10) {
              case "children":
                children$jscomp$8 = propValue$jscomp$10;
                break;
              case "dangerouslySetInnerHTML":
                innerHTML$jscomp$7 = propValue$jscomp$10;
                break;
              default:
                pushAttribute(
                  target$jscomp$0,
                  propKey$jscomp$10,
                  propValue$jscomp$10
                );
            }
        }
      pushViewTransitionAttributes(target$jscomp$0, formatContext);
      target$jscomp$0.push(">");
      if (null != innerHTML$jscomp$7) {
        if (null != children$jscomp$8)
          throw Error(
            "Can only set one of `children` or `props.dangerouslySetInnerHTML`."
          );
        if (
          "object" !== typeof innerHTML$jscomp$7 ||
          !("__html" in innerHTML$jscomp$7)
        )
          throw Error(
            "`props.dangerouslySetInnerHTML` must be in the form `{__html: ...}`. Please visit https://react.dev/link/dangerously-set-inner-html for more information."
          );
        var html: FZ.PropValue = innerHTML$jscomp$7.__html;
        null !== html &&
          void 0 !== html &&
          ("string" === typeof html && 0 < html.length && "\n" === html[0]
            ? target$jscomp$0.push("\n", html)
            : target$jscomp$0.push("" + html));
      }
      "string" === typeof children$jscomp$8 &&
        "\n" === children$jscomp$8[0] &&
        target$jscomp$0.push("\n");
      return children$jscomp$8;
    case "img":
      var pictureOrNoScriptTagInScope: FZ.TagScope = formatContext.tagScope & 3,
        src: FZ.PropValue = props.src,
        srcSet: FZ.PropValue = props.srcSet;
      if (
        !(
          "lazy" === props.loading ||
          (!src && !srcSet) ||
          ("string" !== typeof src && null != src) ||
          ("string" !== typeof srcSet && null != srcSet) ||
          "low" === props.fetchPriority ||
          pictureOrNoScriptTagInScope
        ) &&
        ("string" !== typeof src ||
          ":" !== src[4] ||
          ("d" !== src[0] && "D" !== src[0]) ||
          ("a" !== src[1] && "A" !== src[1]) ||
          ("t" !== src[2] && "T" !== src[2]) ||
          ("a" !== src[3] && "A" !== src[3])) &&
        ("string" !== typeof srcSet ||
          ":" !== srcSet[4] ||
          ("d" !== srcSet[0] && "D" !== srcSet[0]) ||
          ("a" !== srcSet[1] && "A" !== srcSet[1]) ||
          ("t" !== srcSet[2] && "T" !== srcSet[2]) ||
          ("a" !== srcSet[3] && "A" !== srcSet[3]))
      ) {
        null !== hoistableState &&
          formatContext.tagScope & 64 &&
          (hoistableState.suspenseyImages = !0);
        var sizes: string | undefined = "string" === typeof props.sizes ? props.sizes : void 0,
          key$jscomp$0: string = srcSet ? srcSet + "\n" + (sizes || "") : src,
          promotablePreloads: Map<string, FZ.Resource> = renderState.preloads.images,
          resource$jscomp$1: FZ.Resource | undefined = promotablePreloads.get(key$jscomp$0);
        if (resource$jscomp$1) {
          if (
            "high" === props.fetchPriority ||
            10 > renderState.highImagePreloads.size
          )
            promotablePreloads.delete(key$jscomp$0),
              renderState.highImagePreloads.add(resource$jscomp$1);
        } else if (
          !resumableState.imageResources.hasOwnProperty(key$jscomp$0)
        ) {
          resumableState.imageResources[key$jscomp$0] = PRELOAD_NO_CREDS;
          var input: FZ.PropValue = props.crossOrigin;
          var JSCompiler_inline_result$jscomp$8: string | undefined =
            "string" === typeof input
              ? "use-credentials" === input
                ? input
                : ""
              : void 0;
          var headers: FZ.PreloadHeaders | null = renderState.headers,
            header: string;
          headers &&
          0 < headers.remainingCapacity &&
          "string" !== typeof props.srcSet &&
          ("high" === props.fetchPriority ||
            500 > headers.highImagePreloads.length) &&
          ((header = getPreloadAsHeader(src, "image", {
            imageSrcSet: props.srcSet,
            imageSizes: props.sizes,
            crossOrigin: JSCompiler_inline_result$jscomp$8,
            integrity: props.integrity,
            nonce: props.nonce,
            type: props.type,
            fetchPriority: props.fetchPriority,
            referrerPolicy: props.referrerPolicy
          })),
          0 <= (headers.remainingCapacity -= header.length + 2))
            ? ((renderState.resets.image[key$jscomp$0] = PRELOAD_NO_CREDS),
              headers.highImagePreloads && (headers.highImagePreloads += ", "),
              (headers.highImagePreloads += header))
            : ((resource$jscomp$1 = []),
              pushLinkImpl(resource$jscomp$1, {
                rel: "preload",
                as: "image",
                href: srcSet ? void 0 : src,
                imageSrcSet: srcSet,
                imageSizes: sizes,
                crossOrigin: JSCompiler_inline_result$jscomp$8,
                integrity: props.integrity,
                type: props.type,
                fetchPriority: props.fetchPriority,
                referrerPolicy: props.referrerPolicy
              }),
              "high" === props.fetchPriority ||
              10 > renderState.highImagePreloads.size
                ? renderState.highImagePreloads.add(resource$jscomp$1)
                : (renderState.bulkPreloads.add(resource$jscomp$1),
                  promotablePreloads.set(key$jscomp$0, resource$jscomp$1)));
        }
      }
      return pushSelfClosing(target$jscomp$0, props, "img", formatContext);
    case "base":
    case "area":
    case "br":
    case "col":
    case "embed":
    case "hr":
    case "keygen":
    case "param":
    case "source":
    case "track":
    case "wbr":
      return pushSelfClosing(target$jscomp$0, props, type, formatContext);
    case "annotation-xml":
    case "color-profile":
    case "font-face":
    case "font-face-src":
    case "font-face-uri":
    case "font-face-format":
    case "font-face-name":
    case "missing-glyph":
      break;
    case "head":
      if (2 > formatContext.insertionMode) {
        var preamble: FZ.PreambleState = preambleState || renderState.preamble;
        if (preamble.headChunks)
          throw Error("The `<head>` tag may only be rendered once.");
        null !== preambleState && target$jscomp$0.push("\x3c!--head--\x3e");
        preamble.headChunks = [];
        var JSCompiler_inline_result$jscomp$9: FZ.ReactNode = pushStartSingletonElement(
          preamble.headChunks,
          props,
          "head",
          formatContext
        );
      } else
        JSCompiler_inline_result$jscomp$9 = pushStartGenericElement(
          target$jscomp$0,
          props,
          "head",
          formatContext
        );
      return JSCompiler_inline_result$jscomp$9;
    case "body":
      if (2 > formatContext.insertionMode) {
        var preamble$jscomp$0: FZ.PreambleState = preambleState || renderState.preamble;
        if (preamble$jscomp$0.bodyChunks)
          throw Error("The `<body>` tag may only be rendered once.");
        null !== preambleState && target$jscomp$0.push("\x3c!--body--\x3e");
        preamble$jscomp$0.bodyChunks = [];
        var JSCompiler_inline_result$jscomp$10: FZ.ReactNode = pushStartSingletonElement(
          preamble$jscomp$0.bodyChunks,
          props,
          "body",
          formatContext
        );
      } else
        JSCompiler_inline_result$jscomp$10 = pushStartGenericElement(
          target$jscomp$0,
          props,
          "body",
          formatContext
        );
      return JSCompiler_inline_result$jscomp$10;
    case "html":
      if (0 === formatContext.insertionMode) {
        var preamble$jscomp$1: FZ.PreambleState = preambleState || renderState.preamble;
        if (preamble$jscomp$1.htmlChunks)
          throw Error("The `<html>` tag may only be rendered once.");
        null !== preambleState && target$jscomp$0.push("\x3c!--html--\x3e");
        preamble$jscomp$1.htmlChunks = ["<!DOCTYPE html>"];
        var JSCompiler_inline_result$jscomp$11: FZ.ReactNode = pushStartSingletonElement(
          preamble$jscomp$1.htmlChunks,
          props,
          "html",
          formatContext
        );
      } else
        JSCompiler_inline_result$jscomp$11 = pushStartGenericElement(
          target$jscomp$0,
          props,
          "html",
          formatContext
        );
      return JSCompiler_inline_result$jscomp$11;
    default:
      if (-1 !== type.indexOf("-")) {
        target$jscomp$0.push(startChunkForTag(type));
        var children$jscomp$9: FZ.ReactNode = null,
          innerHTML$jscomp$8: FZ.PropValue = null,
          propKey$jscomp$11: string;
        for (propKey$jscomp$11 in props)
          if (hasOwnProperty.call(props, propKey$jscomp$11)) {
            var propValue$jscomp$11 = props[propKey$jscomp$11];
            if (null != propValue$jscomp$11) {
              var attributeName: string = propKey$jscomp$11;
              switch (propKey$jscomp$11) {
                case "children":
                  children$jscomp$9 = propValue$jscomp$11;
                  break;
                case "dangerouslySetInnerHTML":
                  innerHTML$jscomp$8 = propValue$jscomp$11;
                  break;
                case "style":
                  pushStyleAttribute(target$jscomp$0, propValue$jscomp$11);
                  break;
                case "suppressContentEditableWarning":
                case "suppressHydrationWarning":
                case "ref":
                  break;
                case "className":
                  attributeName = "class";
                default:
                  if (
                    isAttributeNameSafe(propKey$jscomp$11) &&
                    "function" !== typeof propValue$jscomp$11 &&
                    "symbol" !== typeof propValue$jscomp$11 &&
                    !1 !== propValue$jscomp$11
                  ) {
                    if (!0 === propValue$jscomp$11) propValue$jscomp$11 = "";
                    else if ("object" === typeof propValue$jscomp$11) continue;
                    target$jscomp$0.push(
                      " ",
                      attributeName,
                      '="',
                      escapeTextForBrowser(propValue$jscomp$11),
                      '"'
                    );
                  }
              }
            }
          }
        pushViewTransitionAttributes(target$jscomp$0, formatContext);
        target$jscomp$0.push(">");
        pushInnerHTML(target$jscomp$0, innerHTML$jscomp$8, children$jscomp$9);
        return children$jscomp$9;
      }
  }
  return pushStartGenericElement(target$jscomp$0, props, type, formatContext);
}
var endTagCache: Map<string, FZ.Chunk> = new Map();
function endChunkForTag(tag: string): FZ.Chunk {
  var chunk = endTagCache.get(tag);
  void 0 === chunk && ((chunk = "</" + tag + ">"), endTagCache.set(tag, chunk));
  return chunk;
}
function hoistPreambleState(renderState$given: FZ.RenderState, preambleState: FZ.PreambleState): void { /*$*/var renderState; renderState = renderState$given;/*$*/
  renderState = renderState.preamble;
  null === renderState.htmlChunks &&
    preambleState.htmlChunks &&
    (renderState.htmlChunks = preambleState.htmlChunks);
  null === renderState.headChunks &&
    preambleState.headChunks &&
    (renderState.headChunks = preambleState.headChunks);
  null === renderState.bodyChunks &&
    preambleState.bodyChunks &&
    (renderState.bodyChunks = preambleState.bodyChunks);
}
function writeBootstrap(destination: FZ.Destination, renderState$given: FZ.RenderState): boolean { /*$*/var renderState, i$asChunk: FZ.Chunk; renderState = renderState$given;/*$*/
  renderState = renderState.bootstrapChunks;
  for (var i = 0; i < renderState.length - 1; i++)
    writeChunk(destination, renderState[i]);
  return i < renderState.length
    ? ((i$asChunk = renderState[i]), (renderState.length = 0), !!destination.write(i$asChunk))
    : !0;
}
function writeStartPendingSuspenseBoundary(destination: FZ.Destination, renderState: FZ.RenderState, id: FZ.SegmentId): boolean {
  writeChunk(destination, '\x3c!--$?--\x3e<template id="');
  if (null === id)
    throw Error(
      "An ID must have been assigned before we can complete the boundary."
    );
  writeChunk(destination, renderState.boundaryPrefix);
  writeChunk(destination, id.toString(16));
  return !!destination.write('"></template>');
}
function writeStartSegment(destination: FZ.Destination, renderState: FZ.RenderState, formatContext: FZ.FormatContext, id: FZ.SegmentId): boolean {
  switch (formatContext.insertionMode) {
    case 0:
    case 1:
    case 3:
    case 2:
      return (
        writeChunk(destination, '<div hidden id="'),
        writeChunk(destination, renderState.segmentPrefix),
        writeChunk(destination, id.toString(16)),
        !!destination.write('">')
      );
    case 4:
      return (
        writeChunk(
          destination,
          '<svg aria-hidden="true" style="display:none" id="'
        ),
        writeChunk(destination, renderState.segmentPrefix),
        writeChunk(destination, id.toString(16)),
        !!destination.write('">')
      );
    case 5:
      return (
        writeChunk(
          destination,
          '<math aria-hidden="true" style="display:none" id="'
        ),
        writeChunk(destination, renderState.segmentPrefix),
        writeChunk(destination, id.toString(16)),
        !!destination.write('">')
      );
    case 6:
      return (
        writeChunk(destination, '<table hidden id="'),
        writeChunk(destination, renderState.segmentPrefix),
        writeChunk(destination, id.toString(16)),
        !!destination.write('">')
      );
    case 7:
      return (
        writeChunk(destination, '<table hidden><tbody id="'),
        writeChunk(destination, renderState.segmentPrefix),
        writeChunk(destination, id.toString(16)),
        !!destination.write('">')
      );
    case 8:
      return (
        writeChunk(destination, '<table hidden><tr id="'),
        writeChunk(destination, renderState.segmentPrefix),
        writeChunk(destination, id.toString(16)),
        !!destination.write('">')
      );
    case 9:
      return (
        writeChunk(destination, '<table hidden><colgroup id="'),
        writeChunk(destination, renderState.segmentPrefix),
        writeChunk(destination, id.toString(16)),
        !!destination.write('">')
      );
    default:
      throw Error("Unknown insertion mode. This is a bug in React.");
  }
}
function writeEndSegment(destination: FZ.Destination, formatContext: FZ.FormatContext): boolean {
  switch (formatContext.insertionMode) {
    case 0:
    case 1:
    case 3:
    case 2:
      return !!destination.write("</div>");
    case 4:
      return !!destination.write("</svg>");
    case 5:
      return !!destination.write("</math>");
    case 6:
      return !!destination.write("</table>");
    case 7:
      return !!destination.write("</tbody></table>");
    case 8:
      return !!destination.write("</tr></table>");
    case 9:
      return !!destination.write("</colgroup></table>");
    default:
      throw Error("Unknown insertion mode. This is a bug in React.");
  }
}
var regexForJSStringsInInstructionScripts = /[<\u2028\u2029]/g;
function escapeJSStringsForInstructionScripts(input: string): string {
  return JSON.stringify(input).replace(
    regexForJSStringsInInstructionScripts,
    function (match) {
      switch (match) {
        case "<":
          return "\\u003c";
        case "\u2028":
          return "\\u2028";
        case "\u2029":
          return "\\u2029";
        default:
          throw Error(
            "escapeJSStringsForInstructionScripts encountered a match it does not know how to replace. this means the match regex and the replacement characters are no longer in sync. This is a bug in React"
          );
      }
    }
  );
}
var regexForJSStringsInScripts = /[&><\u2028\u2029]/g;
function escapeJSObjectForInstructionScripts(input: string): string {
  return JSON.stringify(input).replace(
    regexForJSStringsInScripts,
    function (match) {
      switch (match) {
        case "&":
          return "\\u0026";
        case ">":
          return "\\u003e";
        case "<":
          return "\\u003c";
        case "\u2028":
          return "\\u2028";
        case "\u2029":
          return "\\u2029";
        default:
          throw Error(
            "escapeJSObjectForInstructionScripts encountered a match it does not know how to replace. this means the match regex and the replacement characters are no longer in sync. This is a bug in React"
          );
      }
    }
  );
}
var currentlyRenderingBoundaryHasStylesToHoist: boolean = !1,
  destinationHasCapacity: boolean = !0;
function flushStyleTagsLateForBoundary(this: FZ.Destination, styleQueue: FZ.StyleQueue): void {
  var rules = styleQueue.rules,
    hrefs = styleQueue.hrefs,
    i = 0;
  if (hrefs.length) {
    writeChunk(this, currentlyFlushingRenderState!.startInlineStyle);
    writeChunk(this, ' media="not all" data-precedence="');
    writeChunk(this, styleQueue.precedence);
    for (writeChunk(this, '" data-href="'); i < hrefs.length - 1; i++)
      writeChunk(this, hrefs[i]), writeChunk(this, " ");
    writeChunk(this, hrefs[i]);
    writeChunk(this, '">');
    for (i = 0; i < rules.length; i++) writeChunk(this, rules[i]);
    destinationHasCapacity = !!this.write("</style>");
    currentlyRenderingBoundaryHasStylesToHoist = !0;
    rules.length = 0;
    hrefs.length = 0;
  }
}
function hasStylesToHoist(stylesheet: FZ.StylesheetResource): boolean {
  return 2 !== stylesheet.state
    ? (currentlyRenderingBoundaryHasStylesToHoist = !0)
    : !1;
}
function writeHoistablesForBoundary(destination: FZ.Destination, hoistableState: FZ.HoistableState, renderState: FZ.RenderState): boolean {
  currentlyRenderingBoundaryHasStylesToHoist = !1;
  destinationHasCapacity = !0;
  currentlyFlushingRenderState = renderState;
  hoistableState.styles.forEach(flushStyleTagsLateForBoundary, destination);
  currentlyFlushingRenderState = null;
  hoistableState.stylesheets.forEach(hasStylesToHoist);
  currentlyRenderingBoundaryHasStylesToHoist &&
    (renderState.stylesToHoist = !0);
  return destinationHasCapacity;
}
function flushResource(this: FZ.Destination, resource: FZ.Resource): void {
  for (var i = 0; i < resource.length; i++) writeChunk(this, resource[i]);
  resource.length = 0;
}
var stylesheetFlushingQueue: FZ.Chunk[] = [];
function flushStyleInPreamble(this: FZ.Destination, stylesheet: FZ.StylesheetResource): void {
  pushLinkImpl(stylesheetFlushingQueue, stylesheet.props);
  for (var i = 0; i < stylesheetFlushingQueue.length; i++)
    writeChunk(this, stylesheetFlushingQueue[i]);
  stylesheetFlushingQueue.length = 0;
  stylesheet.state = 2;
}
function flushStylesInPreamble(this: FZ.Destination, styleQueue$given: FZ.StyleQueue): void { /*$*/var styleQueue; styleQueue = styleQueue$given;/*$*/
  var hasStylesheets = 0 < styleQueue.sheets.size;
  styleQueue.sheets.forEach(flushStyleInPreamble, this);
  styleQueue.sheets.clear();
  var rules = styleQueue.rules,
    hrefs = styleQueue.hrefs;
  if (!hasStylesheets || hrefs.length) {
    writeChunk(this, currentlyFlushingRenderState!.startInlineStyle);
    writeChunk(this, ' data-precedence="');
    writeChunk(this, styleQueue.precedence);
    styleQueue = 0;
    if (hrefs.length) {
      for (
        writeChunk(this, '" data-href="');
        styleQueue < hrefs.length - 1;
        styleQueue++
      )
        writeChunk(this, hrefs[styleQueue]), writeChunk(this, " ");
      writeChunk(this, hrefs[styleQueue]);
    }
    writeChunk(this, '">');
    for (styleQueue = 0; styleQueue < rules.length; styleQueue++)
      writeChunk(this, rules[styleQueue]);
    writeChunk(this, "</style>");
    rules.length = 0;
    hrefs.length = 0;
  }
}
function preloadLateStyle(this: FZ.Destination, stylesheet$given: FZ.StylesheetResource): void { /*$*/var stylesheet; stylesheet = stylesheet$given;/*$*/
  if (0 === stylesheet.state) {
    stylesheet.state = 1;
    var props = stylesheet.props;
    pushLinkImpl(stylesheetFlushingQueue, {
      rel: "preload",
      as: "style",
      href: stylesheet.props.href,
      crossOrigin: props.crossOrigin,
      fetchPriority: props.fetchPriority,
      integrity: props.integrity,
      media: props.media,
      hrefLang: props.hrefLang,
      referrerPolicy: props.referrerPolicy
    });
    for (
      stylesheet = 0;
      stylesheet < stylesheetFlushingQueue.length;
      stylesheet++
    )
      writeChunk(this, stylesheetFlushingQueue[stylesheet]);
    stylesheetFlushingQueue.length = 0;
  }
}
function preloadLateStyles(this: FZ.Destination, styleQueue: FZ.StyleQueue): void {
  styleQueue.sheets.forEach(preloadLateStyle, this);
  styleQueue.sheets.clear();
}
function pushCompletedShellIdAttribute(target: FZ.Chunk[], resumableState: FZ.ResumableState): void {
  0 === (resumableState.instructions & 32) &&
    ((resumableState.instructions |= 32),
    target.push(
      ' id="',
      escapeTextForBrowser("_" + resumableState.idPrefix + "R_"),
      '"'
    ));
}
function writeStyleResourceDependenciesInJS(destination: FZ.Destination, hoistableState: FZ.HoistableState): void {
  writeChunk(destination, "[");
  var nextArrayOpenBrackChunk = "[";
  hoistableState.stylesheets.forEach(function (resource) { /*$*/var precedence$asString: string;/*$*/
    if (2 !== resource.state)
      if (3 === resource.state)
        writeChunk(destination, nextArrayOpenBrackChunk),
          writeChunk(
            destination,
            escapeJSObjectForInstructionScripts("" + resource.props.href)
          ),
          writeChunk(destination, "]"),
          (nextArrayOpenBrackChunk = ",[");
      else {
        writeChunk(destination, nextArrayOpenBrackChunk);
        var precedence = resource.props["data-precedence"],
          props = resource.props,
          coercedHref = sanitizeURL("" + resource.props.href);
        writeChunk(
          destination,
          escapeJSObjectForInstructionScripts(coercedHref)
        );
        precedence$asString = "" + precedence;
        writeChunk(destination, ",");
        writeChunk(
          destination,
          escapeJSObjectForInstructionScripts(precedence$asString)
        );
        for (var propKey in props)
          if (
            hasOwnProperty.call(props, propKey) &&
            ((precedence = props[propKey]), null != precedence)
          )
            switch (propKey) {
              case "href":
              case "rel":
              case "precedence":
              case "data-precedence":
                break;
              case "children":
              case "dangerouslySetInnerHTML":
                throw Error(
                  "link is a self-closing tag and must neither have `children` nor use `dangerouslySetInnerHTML`."
                );
              default:
                writeStyleResourceAttributeInJS(
                  destination,
                  propKey,
                  precedence
                );
            }
        writeChunk(destination, "]");
        nextArrayOpenBrackChunk = ",[";
        resource.state = 3;
      }
  });
  writeChunk(destination, "]");
}
function writeStyleResourceAttributeInJS(destination: FZ.Destination, name: string, value: FZ.PropValue): void {
  var attributeName = name.toLowerCase();
  switch (typeof value) {
    case "function":
    case "symbol":
      return;
  }
  switch (name) {
    case "innerHTML":
    case "dangerouslySetInnerHTML":
    case "suppressContentEditableWarning":
    case "suppressHydrationWarning":
    case "style":
    case "ref":
      return;
    case "className":
      attributeName = "class";
      name = "" + value;
      break;
    case "hidden":
      if (!1 === value) return;
      name = "";
      break;
    case "src":
    case "href":
      value = sanitizeURL(value);
      name = "" + value;
      break;
    default:
      if (
        (2 < name.length &&
          ("o" === name[0] || "O" === name[0]) &&
          ("n" === name[1] || "N" === name[1])) ||
        !isAttributeNameSafe(name)
      )
        return;
      name = "" + value;
  }
  writeChunk(destination, ",");
  writeChunk(destination, escapeJSObjectForInstructionScripts(attributeName));
  writeChunk(destination, ",");
  writeChunk(destination, escapeJSObjectForInstructionScripts(name));
}
function createHoistableState(): FZ.HoistableState {
  return { styles: new Set(), stylesheets: new Set(), suspenseyImages: !1 };
}
function prefetchDNS(href: FZ.PropValue): void { /*$*/var resumableState$asHeaders: FZ.PreloadHeaders | null, header$asResource: FZ.Resource;/*$*/
  var request: FZ.Request | null = currentRequest ? currentRequest : null;
  if (request) {
    var resumableState = request.resumableState,
      renderState = request.renderState;
    if ("string" === typeof href && href) {
      if (!resumableState.dnsResources.hasOwnProperty(href)) {
        resumableState.dnsResources[href] = null;
        resumableState$asHeaders = renderState.headers;
        var header: string | undefined, JSCompiler_temp: boolean | null;
        if (
          (JSCompiler_temp =
            resumableState$asHeaders && 0 < resumableState$asHeaders.remainingCapacity)
        )
          JSCompiler_temp =
            ((header =
              "<" +
              ("" + href).replace(
                regexForHrefInLinkHeaderURLContext,
                escapeHrefForLinkHeaderURLContextReplacer
              ) +
              ">; rel=dns-prefetch"),
            0 <= (resumableState$asHeaders.remainingCapacity -= header.length + 2));
        JSCompiler_temp
          ? ((renderState.resets.dns[href] = null),
            resumableState$asHeaders!.preconnects && (resumableState$asHeaders!.preconnects += ", "),
            (resumableState$asHeaders!.preconnects += header!))
          : ((header$asResource = []),
            pushLinkImpl(header$asResource, { href: href, rel: "dns-prefetch" }),
            renderState.preconnects.add(header$asResource));
      }
      enqueueFlush(request);
    }
  } else previousDispatcher.D(href);
}
function preconnect(href: FZ.PropValue, crossOrigin: FZ.PropValue): void { /*$*/var resumableState$asHeaders: FZ.PreloadHeaders | null, bucket$asResource: FZ.Resource, JSCompiler_temp$asHeader: string;/*$*/
  var request: FZ.Request | null = currentRequest ? currentRequest : null;
  if (request) {
    var resumableState = request.resumableState,
      renderState = request.renderState;
    if ("string" === typeof href && href) {
      var bucket: FZ.ConnectBucket =
        "use-credentials" === crossOrigin
          ? "credentials"
          : "string" === typeof crossOrigin
            ? "anonymous"
            : "default";
      if (!resumableState.connectResources[bucket].hasOwnProperty(href)) {
        resumableState.connectResources[bucket][href] = null;
        resumableState$asHeaders = renderState.headers;
        var header: string | undefined, JSCompiler_temp: boolean | null;
        if (
          (JSCompiler_temp =
            resumableState$asHeaders && 0 < resumableState$asHeaders.remainingCapacity)
        ) {
          JSCompiler_temp$asHeader =
            "<" +
            ("" + href).replace(
              regexForHrefInLinkHeaderURLContext,
              escapeHrefForLinkHeaderURLContextReplacer
            ) +
            ">; rel=preconnect";
          if ("string" === typeof crossOrigin) {
            var escapedCrossOrigin = ("" + crossOrigin).replace(
              regexForLinkHeaderQuotedParamValueContext,
              escapeStringForLinkHeaderQuotedParamValueContextReplacer
            );
            JSCompiler_temp$asHeader += '; crossorigin="' + escapedCrossOrigin + '"';
          }
          JSCompiler_temp =
            ((header = JSCompiler_temp$asHeader),
            0 <= (resumableState$asHeaders.remainingCapacity -= header.length + 2));
        }
        JSCompiler_temp
          ? ((renderState.resets.connect[bucket][href] = null),
            resumableState$asHeaders!.preconnects && (resumableState$asHeaders!.preconnects += ", "),
            (resumableState$asHeaders!.preconnects += header!))
          : ((bucket$asResource = []),
            pushLinkImpl(bucket$asResource, {
              rel: "preconnect",
              href: href,
              crossOrigin: crossOrigin
            }),
            renderState.preconnects.add(bucket$asResource));
      }
      enqueueFlush(request);
    }
  } else previousDispatcher.C(href, crossOrigin);
}
function preload(href$given: FZ.PropValue, as: FZ.PropValue, options: FZ.Options): void { /*$*/var href, resumableState$asHeaders: FZ.PreloadHeaders | null, resumableState$asResource: FZ.Resource, imageSrcSet$asResource: FZ.Resource, imageSrcSet$asDict: FZ.ResourceDict, key$asHeader: string; href = href$given;/*$*/
  var request: FZ.Request | null = currentRequest ? currentRequest : null;
  if (request) {
    var resumableState = request.resumableState,
      renderState = request.renderState;
    if (as && href) {
      switch (as) {
        case "image":
          if (options) {
            var imageSrcSet = options.imageSrcSet;
            var imageSizes = options.imageSizes;
            var fetchPriority = options.fetchPriority;
          }
          var key: FZ.PropValue = imageSrcSet
            ? imageSrcSet + "\n" + (imageSizes || "")
            : href;
          if (resumableState.imageResources.hasOwnProperty(key)) return;
          resumableState.imageResources[key] = PRELOAD_NO_CREDS;
          resumableState$asHeaders = renderState.headers;
          var header: string;
          resumableState$asHeaders &&
          0 < resumableState$asHeaders.remainingCapacity &&
          "string" !== typeof imageSrcSet &&
          "high" === fetchPriority &&
          ((header = getPreloadAsHeader(href, as, options)),
          0 <= (resumableState$asHeaders.remainingCapacity -= header.length + 2))
            ? ((renderState.resets.image[key] = PRELOAD_NO_CREDS),
              resumableState$asHeaders.highImagePreloads &&
                (resumableState$asHeaders.highImagePreloads += ", "),
              (resumableState$asHeaders.highImagePreloads += header))
            : ((resumableState$asResource = []),
              pushLinkImpl(
                resumableState$asResource,
                assign(
                  { rel: "preload", href: imageSrcSet ? void 0 : href, as: as },
                  options
                )
              ),
              "high" === fetchPriority
                ? renderState.highImagePreloads.add(resumableState$asResource)
                : (renderState.bulkPreloads.add(resumableState$asResource),
                  renderState.preloads.images.set(key, resumableState$asResource)));
          break;
        case "style":
          if (resumableState.styleResources.hasOwnProperty(href)) return;
          imageSrcSet$asResource = [];
          pushLinkImpl(
            imageSrcSet$asResource,
            assign({ rel: "preload", href: href, as: as }, options)
          );
          resumableState.styleResources[href] =
            !options ||
            ("string" !== typeof options.crossOrigin &&
              "string" !== typeof options.integrity)
              ? PRELOAD_NO_CREDS
              : [options.crossOrigin, options.integrity];
          renderState.preloads.stylesheets.set(href, imageSrcSet$asResource);
          renderState.bulkPreloads.add(imageSrcSet$asResource);
          break;
        case "script":
          if (resumableState.scriptResources.hasOwnProperty(href)) return;
          imageSrcSet$asResource = [];
          renderState.preloads.scripts.set(href, imageSrcSet$asResource);
          renderState.bulkPreloads.add(imageSrcSet$asResource);
          pushLinkImpl(
            imageSrcSet$asResource,
            assign({ rel: "preload", href: href, as: as }, options)
          );
          resumableState.scriptResources[href] =
            !options ||
            ("string" !== typeof options.crossOrigin &&
              "string" !== typeof options.integrity)
              ? PRELOAD_NO_CREDS
              : [options.crossOrigin, options.integrity];
          break;
        default:
          if (resumableState.unknownResources.hasOwnProperty(as)) {
            if (
              ((imageSrcSet$asDict = resumableState.unknownResources[as]),
              imageSrcSet$asDict.hasOwnProperty(href))
            )
              return;
          } else
            (imageSrcSet$asDict = {}),
              (resumableState.unknownResources[as] = imageSrcSet$asDict);
          imageSrcSet$asDict[href] = PRELOAD_NO_CREDS;
          if (
            (resumableState$asHeaders = renderState.headers) &&
            0 < resumableState$asHeaders.remainingCapacity &&
            "font" === as &&
            ((key$asHeader = getPreloadAsHeader(href, as, options)),
            0 <= (resumableState$asHeaders.remainingCapacity -= key$asHeader.length + 2))
          )
            (renderState.resets.font[href] = PRELOAD_NO_CREDS),
              resumableState$asHeaders.fontPreloads &&
                (resumableState$asHeaders.fontPreloads += ", "),
              (resumableState$asHeaders.fontPreloads += key$asHeader);
          else
            switch (
              ((resumableState$asResource = []),
              (href = assign({ rel: "preload", href: href, as: as }, options)),
              pushLinkImpl(resumableState$asResource, href),
              as)
            ) {
              case "font":
                renderState.fontPreloads.add(resumableState$asResource);
                break;
              default:
                renderState.bulkPreloads.add(resumableState$asResource);
            }
      }
      enqueueFlush(request);
    }
  } else previousDispatcher.L(href, as, options);
}
function preloadModule(href: FZ.PropValue, options: FZ.Options): void { /*$*/var as$asResource: FZ.Resource;/*$*/
  var request: FZ.Request | null = currentRequest ? currentRequest : null;
  if (request) {
    var resumableState = request.resumableState,
      renderState = request.renderState;
    if (href) {
      var as: string =
        options && "string" === typeof options.as ? options.as : "script";
      switch (as) {
        case "script":
          if (resumableState.moduleScriptResources.hasOwnProperty(href)) return;
          as$asResource = [];
          resumableState.moduleScriptResources[href] =
            !options ||
            ("string" !== typeof options.crossOrigin &&
              "string" !== typeof options.integrity)
              ? PRELOAD_NO_CREDS
              : [options.crossOrigin, options.integrity];
          renderState.preloads.moduleScripts.set(href, as$asResource);
          break;
        default:
          if (resumableState.moduleUnknownResources.hasOwnProperty(as)) {
            var resources = resumableState.moduleUnknownResources[as];
            if (resources.hasOwnProperty(href)) return;
          } else
            (resources = {}),
              (resumableState.moduleUnknownResources[as] = resources);
          as$asResource = [];
          resources[href] = PRELOAD_NO_CREDS;
      }
      pushLinkImpl(as$asResource, assign({ rel: "modulepreload", href: href }, options));
      renderState.bulkPreloads.add(as$asResource);
      enqueueFlush(request);
    }
  } else previousDispatcher.m(href, options);
}
function preinitStyle(href: FZ.PropValue, precedence$given: FZ.PropValue, options: FZ.Options): void { /*$*/var precedence; precedence = precedence$given;/*$*/ /*$*/var renderState$asResource: FZ.Resource | undefined;/*$*/
  var request: FZ.Request | null = currentRequest ? currentRequest : null;
  if (request) {
    var resumableState = request.resumableState,
      renderState = request.renderState;
    if (href) {
      precedence = precedence || "default";
      var styleQueue: FZ.StyleQueue | undefined = renderState.styles.get(precedence),
        resourceState = resumableState.styleResources.hasOwnProperty(href)
          ? resumableState.styleResources[href]
          : void 0;
      null !== resourceState &&
        ((resumableState.styleResources[href] = null),
        styleQueue ||
          ((styleQueue = {
            precedence: escapeTextForBrowser(precedence),
            rules: [],
            hrefs: [],
            sheets: new Map()
          }),
          renderState.styles.set(precedence, styleQueue)),
        (precedence = {
          state: 0,
          props: assign(
            { rel: "stylesheet", href: href, "data-precedence": precedence },
            options
          )
        }/*$*/ as FZ.StylesheetResource/*$*/),
        resourceState &&
          (2 === resourceState.length &&
            adoptPreloadCredentials(precedence.props, resourceState),
          (renderState$asResource = renderState.preloads.stylesheets.get(href)) &&
          0 < renderState$asResource.length
            ? (renderState$asResource.length = 0)
            : (precedence.state = 1)),
        styleQueue.sheets.set(href, precedence),
        enqueueFlush(request));
    }
  } else previousDispatcher.S(href, precedence, options);
}
function preinitScript(src$given: FZ.PropValue, options$given: FZ.Options): void { /*$*/var src, options; src = src$given; options = options$given;/*$*/
  var request: FZ.Request | null = currentRequest ? currentRequest : null;
  if (request) {
    var resumableState = request.resumableState,
      renderState = request.renderState;
    if (src) {
      var resourceState = resumableState.scriptResources.hasOwnProperty(src)
        ? resumableState.scriptResources[src]
        : void 0;
      null !== resourceState &&
        ((resumableState.scriptResources[src] = null),
        (options = assign({ src: src, async: !0 }, options)),
        resourceState &&
          (2 === resourceState.length &&
            adoptPreloadCredentials(options, resourceState),
          (src = renderState.preloads.scripts.get(src))) &&
          (src.length = 0),
        (src = []/*$*/ as FZ.Resource/*$*/),
        renderState.scripts.add(src),
        pushScriptImpl(src, options),
        enqueueFlush(request));
    }
  } else previousDispatcher.X(src, options);
}
function preinitModuleScript(src$given: FZ.PropValue, options$given: FZ.Options): void { /*$*/var src, options; src = src$given; options = options$given;/*$*/
  var request: FZ.Request | null = currentRequest ? currentRequest : null;
  if (request) {
    var resumableState = request.resumableState,
      renderState = request.renderState;
    if (src) {
      var resourceState = resumableState.moduleScriptResources.hasOwnProperty(
        src
      )
        ? resumableState.moduleScriptResources[src]
        : void 0;
      null !== resourceState &&
        ((resumableState.moduleScriptResources[src] = null),
        (options = assign({ src: src, type: "module", async: !0 }, options)),
        resourceState &&
          (2 === resourceState.length &&
            adoptPreloadCredentials(options, resourceState),
          (src = renderState.preloads.moduleScripts.get(src))) &&
          (src.length = 0),
        (src = []/*$*/ as FZ.Resource/*$*/),
        renderState.scripts.add(src),
        pushScriptImpl(src, options),
        enqueueFlush(request));
    }
  } else previousDispatcher.M(src, options);
}
function adoptPreloadCredentials(target: FZ.PropsBag, preloadState: FZ.PreloadState): void {
  null == target.crossOrigin && (target.crossOrigin = preloadState[0]);
  null == target.integrity && (target.integrity = preloadState[1]);
}
function getPreloadAsHeader(href$given: FZ.PropValue, as$given: FZ.PropValue, params: FZ.Options): string { /*$*/var href, as; href = href$given; as = as$given;/*$*/
  href = ("" + href).replace(
    regexForHrefInLinkHeaderURLContext,
    escapeHrefForLinkHeaderURLContextReplacer
  );
  as = ("" + as).replace(
    regexForLinkHeaderQuotedParamValueContext,
    escapeStringForLinkHeaderQuotedParamValueContextReplacer
  );
  as = "<" + href + '>; rel=preload; as="' + as + '"';
  for (var paramName in params)
    hasOwnProperty.call(params, paramName) &&
      ((href = params[paramName]),
      "string" === typeof href &&
        (as +=
          "; " +
          paramName.toLowerCase() +
          '="' +
          ("" + href).replace(
            regexForLinkHeaderQuotedParamValueContext,
            escapeStringForLinkHeaderQuotedParamValueContextReplacer
          ) +
          '"'));
  return as;
}
var regexForHrefInLinkHeaderURLContext = /[<>\r\n]/g;
function escapeHrefForLinkHeaderURLContextReplacer(match: string): string {
  switch (match) {
    case "<":
      return "%3C";
    case ">":
      return "%3E";
    case "\n":
      return "%0A";
    case "\r":
      return "%0D";
    default:
      throw Error(
        "escapeLinkHrefForHeaderContextReplacer encountered a match it does not know how to replace. this means the match regex and the replacement characters are no longer in sync. This is a bug in React"
      );
  }
}
var regexForLinkHeaderQuotedParamValueContext = /["';,\r\n]/g;
function escapeStringForLinkHeaderQuotedParamValueContextReplacer(match: string): string {
  switch (match) {
    case '"':
      return "%22";
    case "'":
      return "%27";
    case ";":
      return "%3B";
    case ",":
      return "%2C";
    case "\n":
      return "%0A";
    case "\r":
      return "%0D";
    default:
      throw Error(
        "escapeStringForLinkHeaderQuotedParamValueContextReplacer encountered a match it does not know how to replace. this means the match regex and the replacement characters are no longer in sync. This is a bug in React"
      );
  }
}
function hoistStyleQueueDependency(this: FZ.HoistableState, styleQueue: FZ.StyleQueue): void {
  this.styles.add(styleQueue);
}
function hoistStylesheetDependency(this: FZ.HoistableState, stylesheet: FZ.StylesheetResource): void {
  this.stylesheets.add(stylesheet);
}
function hoistHoistables(parentState: FZ.HoistableState, childState: FZ.HoistableState): void {
  childState.styles.forEach(hoistStyleQueueDependency, parentState);
  childState.stylesheets.forEach(hoistStylesheetDependency, parentState);
  childState.suspenseyImages && (parentState.suspenseyImages = !0);
}
function hasSuspenseyContent(hoistableState: FZ.HoistableState, flushingInShell: boolean): boolean {
  return flushingInShell
    ? hoistableState.suspenseyImages
    : 0 < hoistableState.stylesheets.size || hoistableState.suspenseyImages;
}
var bind = Function.prototype.bind,
  REACT_CLIENT_REFERENCE = Symbol.for("react.client.reference");
function getComponentNameFromType(type: FZ.ElementType): FZ.ComponentName {
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
    case REACT_VIEW_TRANSITION_TYPE:
      return "ViewTransition";
  }
  if ("object" === typeof type)
    switch (type.$$typeof) {
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
var emptyContextObject: FZ.EmptyContext = {},
  currentActiveSnapshot: FZ.ContextNode | null = null;
function popToNearestCommonAncestor(prev$given: FZ.ContextNode, next: FZ.ContextNode): void { /*$*/var prev; prev = prev$given;/*$*/
  if (prev !== next) {
    prev.context._currentValue = prev.parentValue;
    prev = prev.parent;
    var parentNext = next.parent;
    if (null === prev) {
      if (null !== parentNext)
        throw Error(
          "The stacks must reach the root at the same time. This is a bug in React."
        );
    } else {
      if (null === parentNext)
        throw Error(
          "The stacks must reach the root at the same time. This is a bug in React."
        );
      popToNearestCommonAncestor(prev, parentNext);
    }
    next.context._currentValue = next.value;
  }
}
function popAllPrevious(prev$given: FZ.ContextNode): void { /*$*/var prev; prev = prev$given;/*$*/
  prev.context._currentValue = prev.parentValue;
  prev = prev.parent;
  null !== prev && popAllPrevious(prev);
}
function pushAllNext(next: FZ.ContextNode): void {
  var parentNext = next.parent;
  null !== parentNext && pushAllNext(parentNext);
  next.context._currentValue = next.value;
}
function popPreviousToCommonLevel(prev$given: FZ.ContextNode, next: FZ.ContextNode): void { /*$*/var prev; prev = prev$given;/*$*/
  prev.context._currentValue = prev.parentValue;
  prev = prev.parent;
  if (null === prev)
    throw Error(
      "The depth must equal at least at zero before reaching the root. This is a bug in React."
    );
  prev.depth === next.depth
    ? popToNearestCommonAncestor(prev, next)
    : popPreviousToCommonLevel(prev, next);
}
function popNextToCommonLevel(prev: FZ.ContextNode, next: FZ.ContextNode): void {
  var parentNext = next.parent;
  if (null === parentNext)
    throw Error(
      "The depth must equal at least at zero before reaching the root. This is a bug in React."
    );
  prev.depth === parentNext.depth
    ? popToNearestCommonAncestor(prev, parentNext)
    : popNextToCommonLevel(prev, parentNext);
  next.context._currentValue = next.value;
}
function switchContext(newSnapshot: FZ.ContextNode | null): void {
  var prev = currentActiveSnapshot;
  prev !== newSnapshot &&
    (null === prev
      ? pushAllNext(newSnapshot!)
      : null === newSnapshot
        ? popAllPrevious(prev)
        : prev.depth === newSnapshot.depth
          ? popToNearestCommonAncestor(prev, newSnapshot)
          : prev.depth > newSnapshot.depth
            ? popPreviousToCommonLevel(prev, newSnapshot)
            : popNextToCommonLevel(prev, newSnapshot),
    (currentActiveSnapshot = newSnapshot));
}
var classComponentUpdater: FZ.ClassComponentUpdater = {
    enqueueSetState: function (inst, payload) {
      inst = inst._reactInternals;
      null !== inst.queue && inst.queue.push(payload);
    },
    enqueueReplaceState: function (inst, payload) {
      inst = inst._reactInternals;
      inst.replace = !0;
      inst.queue = [payload];
    },
    enqueueForceUpdate: function () {}
  },
  emptyTreeContext: FZ.TreeContext = { id: 1, overflow: "" };
function getTreeId(context$given: FZ.TreeContext): string { /*$*/var context; context = context$given;/*$*/
  var overflow = context.overflow;
  context = context.id;
  return (context & ~(1 << (32 - clz32(context) - 1))).toString(32) + overflow;
}
function pushTreeContext(baseContext$given: FZ.TreeContext, totalChildren: FZ.int32, index: number): FZ.TreeContext { /*$*/var baseContext; baseContext = baseContext$given;/*$*/ /*$*/var length$asOverflow: string;/*$*/
  var baseIdWithLeadingBit: FZ.TreeId = baseContext.id as FZ.TreeId;
  baseContext = baseContext.overflow;
  var baseLength: number = (32 - clz32(baseIdWithLeadingBit) - 1) as FZ.int32;
  baseIdWithLeadingBit &= ~(1 << baseLength);
  index += 1;
  var length: FZ.int32 = (32 - clz32(totalChildren) + baseLength) as FZ.int32;
  if (30 < length) {
    var numberOfOverflowBits: FZ.int32 = (baseLength - (baseLength % 5)) as FZ.int32;
    length$asOverflow = (
      baseIdWithLeadingBit &
      ((1 << numberOfOverflowBits) - 1)
    ).toString(32);
    baseIdWithLeadingBit >>= numberOfOverflowBits;
    baseLength -= numberOfOverflowBits;
    return {
      id:
        (1 << (32 - clz32(totalChildren) + baseLength)) |
        (index << baseLength) |
        baseIdWithLeadingBit,
      overflow: length$asOverflow + baseContext
    };
  }
  return {
    id: (1 << length) | (index << baseLength) | baseIdWithLeadingBit,
    overflow: baseContext
  };
}
var clz32: (x: number) => number = Math.clz32 ? Math.clz32 : clz32Fallback,
  log = Math.log,
  LN2 = Math.LN2;
function clz32Fallback(x: number): number {
  x >>>= 0;
  return 0 === x ? 32 : (31 - ((log(x) / LN2) | 0)) | 0;
}
function noop(): void {}
var SuspenseException = Error(
  "Suspense Exception: This is not a real error! It's an implementation detail of `use` to interrupt the current render. You must either rethrow it immediately, or move the `use` call outside of the `try/catch` block. Capturing without rethrowing will lead to unexpected behavior.\n\nTo handle async errors, wrap your component in an error boundary, or call the promise's `.catch` method and pass the result to `use`."
);
function trackUsedThenable(thenableState$given: FZ.ThenableState, thenable: FZ.Thenable, index$given: FZ.int32): FZ.FulfilledValue { /*$*/var thenableState, index; thenableState = thenableState$given; index = index$given;/*$*/
  index = thenableState[index];
  void 0 === index
    ? thenableState.push(thenable)
    : index !== thenable && (thenable.then(noop, noop), (thenable = index));
  switch (thenable.status) {
    case "fulfilled":
      return thenable.value;
    case "rejected":
      thenableState = thenable.reason;
      if (void 0 === thenableState && !("reason" in thenable))
        throw Error(
          "A rejected Promise was passed to React without a `reason` property. React threw a generic error from where the Promise was used to assist in identifying the problematic Promise. Make sure that instrumented Promises correctly set the `reason` property when setting `status` to `'rejected'`."
        );
      throw thenableState;
    default:
      "string" === typeof thenable.status
        ? thenable.then(noop, noop)
        : ((thenableState = thenable),
          (thenableState.status = "pending"),
          thenableState.then(
            function (fulfilledValue: FZ.FulfilledValue) {
              if ("pending" === thenable.status) {
                var fulfilledThenable = thenable;
                fulfilledThenable.status = "fulfilled";
                fulfilledThenable.value = fulfilledValue;
              }
            },
            function (error: FZ.Thrown) {
              if ("pending" === thenable.status) {
                var rejectedThenable = thenable;
                rejectedThenable.status = "rejected";
                rejectedThenable.reason = error;
              }
            }
          ));
      switch (thenable.status) {
        case "fulfilled":
          return thenable.value;
        case "rejected":
          throw thenable.reason;
      }
      suspendedThenable = thenable;
      throw SuspenseException;
  }
}
var suspendedThenable: FZ.Thenable = null;
function getSuspendedThenable(): FZ.Thenable {
  if (null === suspendedThenable)
    throw Error(
      "Expected a suspended thenable. This is a bug in React. Please file an issue."
    );
  var thenable = suspendedThenable;
  suspendedThenable = null;
  return thenable;
}
function is(x: FZ.ComparedValue, y: FZ.ComparedValue): boolean {
  return (x === y && (0 !== x || 1 / x === 1 / y)) || (x !== x && y !== y);
}
var objectIs: (x: FZ.ComparedValue, y: FZ.ComparedValue) => boolean = "function" === typeof Object.is ? Object.is : is,
  currentlyRenderingComponent: FZ.ComponentIdentity | null = null,
  currentlyRenderingTask: FZ.Task | null = null,
  currentlyRenderingRequest: FZ.Request | null = null,
  currentlyRenderingKeyPath: FZ.KeyNode | null = null,
  firstWorkInProgressHook: FZ.Hook | null = null,
  workInProgressHook: FZ.Hook | null = null,
  isReRender: boolean = !1,
  didScheduleRenderPhaseUpdate: boolean = !1,
  localIdCounter: number = 0,
  actionStateCounter: number = 0,
  actionStateMatchingIndex: FZ.HookCounter = -1,
  thenableIndexCounter: number = 0,
  thenableState: FZ.ThenableState | null = null;
function createRecoverableError(recoverable: FZ.Recoverable): Error { /*$*/var initializedReason$asError: Error;/*$*/
  recoverable = recoverable._reason;
  if ("function" === typeof recoverable)
    try {
      var initializedReason = recoverable();
    } catch ($jscomp$unused$catch) {
      initializedReason =
        "The reason for browser-only rendering could not be determined because its initializer threw.";
    }
  else initializedReason = recoverable;
  initializedReason$asError = Error(
    "Browser-only rendering was requested by `browser()`.",
    void 0 === recoverable ? void 0 : { cause: initializedReason }
  );
  Object.defineProperty(initializedReason$asError, REACT_RECOVERABLE_TYPE, {
    value: !0
  });
  return initializedReason$asError;
}
function isRecoverableError(error: FZ.Thrown): boolean {
  return "object" !== typeof error || null === error
    ? !1
    : !0 === error[REACT_RECOVERABLE_TYPE];
}
function cloneRecoverableErrorAsFatal(recoverableError: FZ.Thrown): Error {
  var fatalRecoverableError = Error(
    "The server render could not complete because client rendering was requested outside a Suspense boundary. See this error's cause for additional details.",
    hasOwnProperty.call(recoverableError, "cause")
      ? { cause: recoverableError.cause }
      : void 0
  );
  recoverableError = recoverableError.stack;
  if (void 0 !== recoverableError) {
    var frameStart = recoverableError.indexOf("\n");
    fatalRecoverableError.stack =
      fatalRecoverableError.name +
      ": " +
      fatalRecoverableError.message +
      (-1 === frameStart ? "" : recoverableError.slice(frameStart));
  } else /*$*/(/*$*/fatalRecoverableError/*$*/ as any)/*$*/.stack = void 0;
  return fatalRecoverableError;
}
var renderPhaseUpdates: Map<FZ.UpdateQueue, FZ.Update> | null = null,
  numberOfReRenders: number = 0;
function resolveCurrentlyRenderingComponent(): FZ.ComponentIdentity {
  if (null === currentlyRenderingComponent)
    throw Error(
      "Invalid hook call. Hooks can only be called inside of the body of a function component. This could happen for one of the following reasons:\n1. You might have mismatching versions of React and the renderer (such as React DOM)\n2. You might be breaking the Rules of Hooks\n3. You might have more than one copy of React in the same app\nSee https://react.dev/link/invalid-hook-call for tips about how to debug and fix this problem."
    );
  return currentlyRenderingComponent;
}
function createHook(): FZ.Hook {
  if (0 < numberOfReRenders)
    throw Error("Rendered more hooks than during the previous render");
  return { memoizedState: null, queue: null, next: null };
}
function createWorkInProgressHook(): FZ.Hook {
  null === workInProgressHook
    ? null === firstWorkInProgressHook
      ? ((isReRender = !1),
        (firstWorkInProgressHook = workInProgressHook = createHook()))
      : ((isReRender = !0), (workInProgressHook = firstWorkInProgressHook))
    : null === workInProgressHook.next
      ? ((isReRender = !1),
        (workInProgressHook = workInProgressHook.next = createHook()))
      : ((isReRender = !0), (workInProgressHook = workInProgressHook.next));
  return workInProgressHook;
}
function getThenableStateAfterSuspending(): FZ.ThenableState | null {
  var state = thenableState;
  thenableState = null;
  return state;
}
function resetHooksState(): void {
  currentlyRenderingKeyPath =
    currentlyRenderingRequest =
    currentlyRenderingTask =
    currentlyRenderingComponent =
      null;
  didScheduleRenderPhaseUpdate = !1;
  firstWorkInProgressHook = null;
  numberOfReRenders = 0;
  workInProgressHook = renderPhaseUpdates = null;
}
function basicStateReducer(state: FZ.HookState, action: FZ.HookState): FZ.HookState {
  return "function" === typeof action ? action(state) : action;
}
function useReducer(reducer$given: FZ.Reducer, initialArg$given: FZ.HookState, init$given?: (initialArg: FZ.HookState) => FZ.HookState): FZ.DispatchTuple { /*$*/var reducer, initialArg, init; reducer = reducer$given; initialArg = initialArg$given; init = init$given; var init$asUpdate: FZ.Update | null | undefined;/*$*/
  currentlyRenderingComponent = resolveCurrentlyRenderingComponent();
  workInProgressHook = createWorkInProgressHook();
  if (isReRender) {
    var queue = workInProgressHook.queue!;/*$*/var queue$asState: FZ.HookState;/*$*/
    initialArg = queue.dispatch;
    if (
      null !== renderPhaseUpdates &&
      ((init$asUpdate = renderPhaseUpdates.get(queue)), void 0 !== init$asUpdate)
    ) {
      renderPhaseUpdates.delete(queue);
      queue$asState = workInProgressHook.memoizedState;
      do (queue$asState = reducer(queue$asState, init$asUpdate.action)), (init$asUpdate = init$asUpdate.next);
      while (null !== init$asUpdate);
      workInProgressHook.memoizedState = queue$asState;
      return [queue$asState, initialArg];
    }
    return [workInProgressHook.memoizedState, initialArg];
  }
  reducer =
    reducer === basicStateReducer
      ? "function" === typeof initialArg
        ? initialArg()
        : initialArg
      : void 0 !== init
        ? init(initialArg)
        : initialArg;
  workInProgressHook.memoizedState = reducer;
  reducer = workInProgressHook.queue = { last: null, dispatch: null }/*$*/ as FZ.UpdateQueue/*$*/;
  reducer = reducer.dispatch = dispatchAction.bind(
    null,
    currentlyRenderingComponent,
    reducer
  );
  return [workInProgressHook.memoizedState, reducer];
}
function useMemo(nextCreate$given: () => FZ.MemoValue, deps: FZ.HookDeps): FZ.MemoValue { /*$*/var nextCreate; nextCreate = nextCreate$given;/*$*/
  currentlyRenderingComponent = resolveCurrentlyRenderingComponent();
  workInProgressHook = createWorkInProgressHook();
  deps = void 0 === deps ? null : deps;
  if (null !== workInProgressHook) {
    var prevState = workInProgressHook.memoizedState;
    if (null !== prevState && null !== deps) {
      var prevDeps = prevState[1];
      a: if (null === prevDeps) prevDeps = !1;
      else {
        for (var i = 0; i < prevDeps.length && i < deps.length; i++)
          if (!objectIs(deps[i], prevDeps[i])) {
            prevDeps = !1;
            break a;
          }
        prevDeps = !0;
      }
      if (prevDeps) return prevState[0];
    }
  }
  nextCreate = nextCreate();
  workInProgressHook.memoizedState = [nextCreate, deps];
  return nextCreate;
}
function dispatchAction(componentIdentity$given: FZ.ComponentIdentity, queue$given: FZ.UpdateQueue, action$given: FZ.HookState): void { /*$*/var componentIdentity: FZ.ComponentIdentity, queue: FZ.UpdateQueue, action: FZ.HookState; componentIdentity = componentIdentity$given; queue = queue$given; action = action$given; var componentIdentity$asUpdate: FZ.Update; var action$asFirst: FZ.Update | undefined; var queue$asLast: FZ.Update;/*$*/
  if (25 <= numberOfReRenders)
    throw Error(
      "Too many re-renders. React limits the number of renders to prevent an infinite loop."
    );
  if (componentIdentity === currentlyRenderingComponent)
    if (
      ((didScheduleRenderPhaseUpdate = !0),
      (componentIdentity$asUpdate = { action: action, next: null }/*$*/ as FZ.Update/*$*/),
      null === renderPhaseUpdates && (renderPhaseUpdates = new Map()),
      (action$asFirst = renderPhaseUpdates.get(queue)),
      void 0 === action$asFirst)
    )
      renderPhaseUpdates.set(queue, componentIdentity$asUpdate);
    else {
      for (queue$asLast = action$asFirst; null !== queue$asLast.next; ) queue$asLast = queue$asLast.next;
      queue$asLast.next = componentIdentity$asUpdate;
    }
}
function throwOnUseEffectEventCall() {
  throw Error(
    "A function wrapped in useEffectEvent can't be called during rendering."
  );
}
function unsupportedStartTransition() {
  throw Error("startTransition cannot be called during server rendering.");
}
function unsupportedSetOptimisticState() {
  throw Error("Cannot update optimistic state while rendering.");
}
function useActionState(action: FZ.FormAction, initialState: FZ.HookState, permalink?: FZ.PropValue): FZ.ActionStateTuple { /*$*/var action$asDispatch: FZ.ActionDispatch, request$asFormState: FZ.ReactFormState;/*$*/
  resolveCurrentlyRenderingComponent();
  var actionStateHookIndex: number = actionStateCounter++,
    request = currentlyRenderingRequest;
  if ("function" === typeof action.$$FORM_ACTION) {
    var nextPostbackStateKey: string | null = null,
      componentKeyPath = currentlyRenderingKeyPath;
    request$asFormState = request!.formState;
    var isSignatureEqual = action.$$IS_SIGNATURE_EQUAL;
    if (null !== request$asFormState && "function" === typeof isSignatureEqual) {
      var postbackKey = request$asFormState[1];
      isSignatureEqual.call(action, request$asFormState[2], request$asFormState[3]) &&
        ((nextPostbackStateKey =
          void 0 !== permalink
            ? "p" + permalink
            : "k" +
              Bun.hash(
                JSON.stringify([componentKeyPath, null, actionStateHookIndex])
              )),
        postbackKey === nextPostbackStateKey &&
          ((actionStateMatchingIndex = actionStateHookIndex as FZ.HookCounter),
          (initialState = request$asFormState[0])));
    }
    var boundAction = action.bind(null, initialState);
    action$asDispatch = function (payload) {
      boundAction(payload);
    };
    "function" === typeof boundAction.$$FORM_ACTION &&
      (action$asDispatch.$$FORM_ACTION = function (prefix) {
        prefix = boundAction.$$FORM_ACTION(prefix);
        void 0 !== permalink &&
          ((permalink += ""), (prefix.action = permalink));
        var formData = prefix.data;
        formData &&
          (null === nextPostbackStateKey &&
            (nextPostbackStateKey =
              void 0 !== permalink
                ? "p" + permalink
                : "k" +
                  Bun.hash(
                    JSON.stringify([
                      componentKeyPath,
                      null,
                      actionStateHookIndex
                    ])
                  )),
          formData.append("$ACTION_KEY", nextPostbackStateKey));
        return prefix;
      });
    return [initialState, action$asDispatch, !1];
  }
  var boundAction$22 = action.bind(null, initialState);
  return [
    initialState,
    function (payload) {
      boundAction$22(payload);
    },
    !1
  ];
}
function unwrapThenable(thenable: FZ.Thenable): FZ.UsedValue {
  var index: FZ.HookCounter = thenableIndexCounter as FZ.HookCounter;
  thenableIndexCounter += 1;
  null === thenableState && (thenableState = []);
  return trackUsedThenable(thenableState, thenable, index);
}
function unsupportedRefresh() {
  throw Error("Cache cannot be refreshed during server rendering.");
}
var HooksDispatcher: FZ.Dispatcher = {
    readContext: function (context) {
      return context._currentValue;
    },
    use: function (usable) {
      if (null !== usable && "object" === typeof usable) {
        if ("function" === typeof usable.then) return unwrapThenable(usable);
        if (usable.$$typeof === REACT_RECOVERABLE_TYPE)
          throw createRecoverableError(usable);
        if (usable.$$typeof === REACT_CONTEXT_TYPE) return usable._currentValue;
      }
      throw Error("An unsupported type was passed to use(): " + String(usable));
    },
    useContext: function (context) {
      resolveCurrentlyRenderingComponent();
      return context._currentValue;
    },
    useMemo: useMemo,
    useReducer: useReducer,
    useRef: function (initialValue) { /*$*/var initialValue$asRef: FZ.RefObject;/*$*/
      currentlyRenderingComponent = resolveCurrentlyRenderingComponent();
      workInProgressHook = createWorkInProgressHook();
      var previousRef = workInProgressHook.memoizedState;
      return null === previousRef
        ? ((initialValue$asRef = { current: initialValue }),
          (workInProgressHook.memoizedState = initialValue$asRef))
        : previousRef;
    },
    useState: function (initialState) {
      return useReducer(basicStateReducer, initialState);
    },
    useInsertionEffect: noop,
    useLayoutEffect: noop,
    useCallback: function (callback, deps) {
      return useMemo(function () {
        return callback;
      }, deps);
    },
    useImperativeHandle: noop,
    useEffect: noop,
    useDebugValue: noop,
    useDeferredValue: function (value, initialValue) {
      resolveCurrentlyRenderingComponent();
      return void 0 !== initialValue ? initialValue : value;
    },
    useTransition: function () {
      resolveCurrentlyRenderingComponent();
      return [!1, unsupportedStartTransition];
    },
    useId: function () {
      var treeId = getTreeId(currentlyRenderingTask!.treeContext),
        resumableState = currentResumableState;
      if (null === resumableState)
        throw Error(
          "Invalid hook call. Hooks can only be called inside of the body of a function component."
        );
      var localId: number = localIdCounter++;
      return makeId(resumableState, treeId, localId as FZ.int32);
    },
    useSyncExternalStore: function (subscribe, getSnapshot, getServerSnapshot) {
      if (void 0 === getServerSnapshot)
        throw Error(
          "Missing getServerSnapshot, which is required for server-rendered content. Will revert to client rendering."
        );
      return getServerSnapshot();
    },
    useOptimistic: function (passthrough) {
      resolveCurrentlyRenderingComponent();
      return [passthrough, unsupportedSetOptimisticState];
    },
    useActionState: useActionState,
    useFormState: useActionState,
    useHostTransitionStatus: function () {
      resolveCurrentlyRenderingComponent();
      return sharedNotPendingObject;
    },
    useMemoCache: function (size) {
      for (var data = Array(size), i = 0; i < size; i++)
        data[i] = REACT_MEMO_CACHE_SENTINEL;
      return data;
    },
    useCacheRefresh: function () {
      return unsupportedRefresh;
    },
    useEffectEvent: function () {
      return throwOnUseEffectEventCall;
    }
  },
  currentResumableState: FZ.ResumableState | null = null,
  DefaultAsyncDispatcher: FZ.AsyncDispatcher = {
    getCacheForType: function () {
      throw Error("Not implemented.");
    },
    cacheSignal: function () {
      throw Error("Not implemented.");
    }
  },
  prefix: string | undefined,
  suffix: string | undefined;
function describeBuiltInComponentFrame(name: FZ.PropValue): string {
  if (void 0 === prefix)
    try {
      throw Error();
    } catch (x: FZ.Thrown) {
      var match = x.stack.trim().match(/\n( *(at )?)/);
      prefix = (match && match[1]) || "";
      suffix =
        -1 < x.stack.indexOf("\n    at")
          ? " (<anonymous>)"
          : -1 < x.stack.indexOf("@")
            ? "@unknown:0:0"
            : "";
    }
  return "\n" + prefix + name + suffix;
}
var reentry = !1;
function describeNativeComponentFrame(fn: FZ.ElementType, construct: boolean): string { /*$*/var RunInRootFrame$asIndex: number, namePropDescriptor$asIndex: number;/*$*/
  if (!fn || reentry) return "";
  reentry = !0;
  var previousPrepareStackTrace = /*$*/(/*$*/Error/*$*/ as any)/*$*/.prepareStackTrace;
  /*$*/(/*$*/Error/*$*/ as any)/*$*/.prepareStackTrace = void 0;
  try {
    var RunInRootFrame: FZ.RunInRootFrame = {
      DetermineComponentFrameRoot: function () { /*$*/var Fake$asDidSet: boolean, Fake$asResult: FZ.ReactNode;/*$*/
        try {
          if (construct) {
            var Fake = function () {
              throw Error();
            };
            Object.defineProperty(Fake.prototype, "props", {
              set: function () {
                throw Error();
              }
            });
            if ("object" === typeof Reflect && Reflect.construct) {
              try {
                Reflect.construct(Fake, []);
              } catch (x: FZ.Thrown) {
                var control = x;
              }
              Reflect.construct(fn, [], Fake);
            } else {
              try {
                /*$*/(/*$*/Fake/*$*/ as any)/*$*/.call();
              } catch (x$24: FZ.Thrown) {
                control = x$24;
              }
              Fake$asDidSet = !1;
              try {
                var prevProps = Object.getOwnPropertyDescriptor(
                  fn.prototype,
                  "props"
                );
                Object.defineProperty(fn.prototype, "props", {
                  configurable: !0,
                  set: function () {
                    throw Error();
                  }
                });
                Fake$asDidSet = !0;
                new fn();
              } finally {
                Fake$asDidSet &&
                  (void 0 !== prevProps
                    ? Object.defineProperty(fn.prototype, "props", prevProps)
                    : delete fn.prototype.props);
              }
            }
          } else {
            try {
              throw Error();
            } catch (x$25: FZ.Thrown) {
              control = x$25;
            }
            (Fake$asResult = fn()) &&
              "function" === typeof Fake$asResult.catch &&
              Fake$asResult.catch(function () {});
          }
        } catch (sample: FZ.Thrown) {
          if (sample && control && "string" === typeof sample.stack)
            return [sample.stack, control.stack];
        }
        return [null, null];
      }
    };
    RunInRootFrame.DetermineComponentFrameRoot.displayName =
      "DetermineComponentFrameRoot";
    var namePropDescriptor = Object.getOwnPropertyDescriptor(
      RunInRootFrame.DetermineComponentFrameRoot,
      "name"
    );
    namePropDescriptor &&
      namePropDescriptor.configurable &&
      Object.defineProperty(
        RunInRootFrame.DetermineComponentFrameRoot,
        "name",
        { value: "DetermineComponentFrameRoot" }
      );
    var _RunInRootFrame$Deter = RunInRootFrame.DetermineComponentFrameRoot(),
      sampleStack = _RunInRootFrame$Deter[0],
      controlStack = _RunInRootFrame$Deter[1];
    if (sampleStack && controlStack) {
      var sampleLines = sampleStack.split("\n"),
        controlLines = controlStack.split("\n");
      for (
        namePropDescriptor$asIndex = RunInRootFrame$asIndex = 0;
        RunInRootFrame$asIndex < sampleLines.length &&
        !sampleLines[RunInRootFrame$asIndex].includes("DetermineComponentFrameRoot");

      )
        RunInRootFrame$asIndex++;
      for (
        ;
        namePropDescriptor$asIndex < controlLines.length &&
        !controlLines[namePropDescriptor$asIndex].includes(
          "DetermineComponentFrameRoot"
        );

      )
        namePropDescriptor$asIndex++;
      if (
        RunInRootFrame$asIndex === sampleLines.length ||
        namePropDescriptor$asIndex === controlLines.length
      )
        for (
          RunInRootFrame$asIndex = sampleLines.length - 1,
            namePropDescriptor$asIndex = controlLines.length - 1;
          1 <= RunInRootFrame$asIndex &&
          0 <= namePropDescriptor$asIndex &&
          sampleLines[RunInRootFrame$asIndex] !== controlLines[namePropDescriptor$asIndex];

        )
          namePropDescriptor$asIndex--;
      for (
        ;
        1 <= RunInRootFrame$asIndex && 0 <= namePropDescriptor$asIndex;
        RunInRootFrame$asIndex--, namePropDescriptor$asIndex--
      )
        if (sampleLines[RunInRootFrame$asIndex] !== controlLines[namePropDescriptor$asIndex]) {
          if (1 !== RunInRootFrame$asIndex || 1 !== namePropDescriptor$asIndex) {
            do
              if (
                (RunInRootFrame$asIndex--,
                namePropDescriptor$asIndex--,
                0 > namePropDescriptor$asIndex ||
                  sampleLines[RunInRootFrame$asIndex] !==
                    controlLines[namePropDescriptor$asIndex])
              ) {
                var frame =
                  "\n" +
                  sampleLines[RunInRootFrame$asIndex].replace(" at new ", " at ");
                fn.displayName &&
                  frame.includes("<anonymous>") &&
                  (frame = frame.replace("<anonymous>", fn.displayName));
                return frame;
              }
            while (1 <= RunInRootFrame$asIndex && 0 <= namePropDescriptor$asIndex);
          }
          break;
        }
    }
  } finally {
    (reentry = !1), (/*$*/(/*$*/Error/*$*/ as any)/*$*/.prepareStackTrace = previousPrepareStackTrace);
  }
  return (previousPrepareStackTrace = fn ? fn.displayName || fn.name : "")
    ? describeBuiltInComponentFrame(previousPrepareStackTrace)
    : "";
}
function describeComponentStackByType(type: FZ.ElementType): string {
  if ("string" === typeof type) return describeBuiltInComponentFrame(type);
  if ("function" === typeof type)
    return type.prototype && type.prototype.isReactComponent
      ? describeNativeComponentFrame(type, !0)
      : describeNativeComponentFrame(type, !1);
  if ("object" === typeof type && null !== type) {
    switch (type.$$typeof) {
      case REACT_FORWARD_REF_TYPE:
        return describeNativeComponentFrame(type.render, !1);
      case REACT_MEMO_TYPE:
        return describeNativeComponentFrame(type.type, !1);
      case REACT_LAZY_TYPE:
        var lazyComponent: FZ.LazyComponent = type,
          payload: FZ.PropValue = lazyComponent._payload;
        lazyComponent = lazyComponent._init;
        try {
          type = lazyComponent(payload);
        } catch (x: FZ.Thrown) {
          return describeBuiltInComponentFrame("Lazy");
        }
        return describeComponentStackByType(type);
    }
    if ("string" === typeof type.name) {
      a: {
        payload = type.name;
        lazyComponent = type.env;
        var location: FZ.PropValue = type.debugLocation;
        if (
          null != location &&
          ((type = /*$*/(/*$*/Error/*$*/ as any)/*$*/.prepareStackTrace),
          (/*$*/(/*$*/Error/*$*/ as any)/*$*/.prepareStackTrace = void 0),
          (location = location.stack),
          (/*$*/(/*$*/Error/*$*/ as any)/*$*/.prepareStackTrace = type),
          location.startsWith("Error: react-stack-top-frame\n") &&
            (location = location.slice(29)),
          (type = location.indexOf("\n")),
          -1 !== type && (location = location.slice(type + 1)),
          (type = location.indexOf("react_stack_bottom_frame")),
          -1 !== type && (type = location.lastIndexOf("\n", type)),
          (type = -1 !== type ? (location = location.slice(0, type)) : ""),
          (location = type.lastIndexOf("\n")),
          (type = -1 === location ? type : type.slice(location + 1)),
          -1 !== type.indexOf(payload))
        ) {
          payload = "\n" + type;
          break a;
        }
        payload = describeBuiltInComponentFrame(
          payload + (lazyComponent ? " [" + lazyComponent + "]" : "")
        );
      }
      return payload;
    }
  }
  switch (type) {
    case REACT_SUSPENSE_LIST_TYPE:
      return describeBuiltInComponentFrame("SuspenseList");
    case REACT_SUSPENSE_TYPE:
      return describeBuiltInComponentFrame("Suspense");
    case REACT_VIEW_TRANSITION_TYPE:
      return describeBuiltInComponentFrame("ViewTransition");
  }
  return "";
}
function getViewTransitionClassName(defaultClass: FZ.PropValue, eventClass: FZ.PropValue): FZ.ViewTransitionValue {
  defaultClass =
    null == defaultClass || "string" === typeof defaultClass
      ? defaultClass
      : defaultClass.default;
  eventClass =
    null == eventClass || "string" === typeof eventClass
      ? eventClass
      : eventClass.default;
  return null == eventClass
    ? "auto" === defaultClass
      ? null
      : defaultClass
    : "auto" === eventClass
      ? null
      : eventClass;
}
function isEligibleForOutlining(request: FZ.Request, boundary: FZ.SuspenseBoundary): boolean {
  return (
    (500 < boundary.byteSize ||
      hasSuspenseyContent(boundary.contentState, !1) ||
      boundary.defer) &&
    null === boundary.preamble
  );
}
function defaultErrorHandler(error: FZ.Thrown): null {
  if (
    "object" === typeof error &&
    null !== error &&
    "string" === typeof error.environmentName
  ) {
    var JSCompiler_inline_result: FZ.PropValue = error.environmentName;
    error = [error].slice(0);
    "string" === typeof error[0]
      ? error.splice(
          0,
          1,
          "%c%s%c " + error[0],
          "background: #e6e6e6;background: light-dark(rgba(0,0,0,0.1), rgba(255,255,255,0.25));color: #000000;color: light-dark(#000000, #ffffff);border-radius: 2px",
          " " + JSCompiler_inline_result + " ",
          ""
        )
      : error.splice(
          0,
          0,
          "%c%s%c",
          "background: #e6e6e6;background: light-dark(rgba(0,0,0,0.1), rgba(255,255,255,0.25));color: #000000;color: light-dark(#000000, #ffffff);border-radius: 2px",
          " " + JSCompiler_inline_result + " ",
          ""
        );
    error.unshift(console);
    JSCompiler_inline_result = bind.apply(console.error, error);
    JSCompiler_inline_result();
  } else console.error(error);
  return null;
}
function RequestInstance(this: FZ.Request,
  resumableState: FZ.ResumableState,
  renderState: FZ.RenderState,
  rootFormatContext: FZ.FormatContext,
  progressiveChunkSize: number | undefined,
  onError: FZ.ErrorHandler | undefined,
  onBrowserBailout: FZ.BailoutHandler | undefined,
  onAllReady: (() => void) | undefined,
  onShellReady: (() => void) | undefined,
  onShellError: ((error: FZ.Thrown) => void) | undefined,
  onFatalError: ((error: FZ.Thrown) => void) | undefined,
  formState: FZ.ReactFormState
) {
  var abortSet = new Set<FZ.Task>();
  this.destination = null;
  this.flushScheduled = !1;
  this.resumableState = resumableState;
  this.renderState = renderState;
  this.rootFormatContext = rootFormatContext;
  this.progressiveChunkSize =
    void 0 === progressiveChunkSize ? 12800 : progressiveChunkSize;
  this.status = 10;
  this.fatalError = null;
  this.aborted = !1;
  this.pendingRootTasks = this.allPendingTasks = this.nextSegmentId = 0;
  this.completedPreambleSegments = this.completedRootSegment = null;
  this.byteSize = 0;
  this.abortableTasks = abortSet;
  this.pingedTasks = [];
  this.currentTask = null;
  this.clientRenderedBoundaries = [];
  this.completedBoundaries = [];
  this.partialBoundaries = [];
  this.postponedState = this.trackedPostpones = null;
  this.onError = void 0 === onError ? defaultErrorHandler : onError;
  this.onBrowserBailout = void 0 === onBrowserBailout ? noop : onBrowserBailout;
  this.onAllReady = void 0 === onAllReady ? noop : onAllReady;
  this.onShellReady = void 0 === onShellReady ? noop : onShellReady;
  this.onShellError = void 0 === onShellError ? noop : onShellError;
  this.onFatalError = void 0 === onFatalError ? noop : onFatalError;
  this.renderLifetimeController = null;
  this.formState = void 0 === formState ? null : formState;
}
function createRequest(
  children$given: FZ.ReactNode,
  resumableState$given: FZ.ResumableState,
  renderState$given: FZ.RenderState,
  rootFormatContext: FZ.FormatContext,
  progressiveChunkSize: number | undefined,
  onError: FZ.ErrorHandler | undefined,
  onBrowserBailout: FZ.BailoutHandler | undefined,
  onAllReady: (() => void) | undefined,
  onShellReady: (() => void) | undefined,
  onShellError: ((error: FZ.Thrown) => void) | undefined,
  onFatalError: ((error: FZ.Thrown) => void) | undefined,
  formState: FZ.ReactFormState
): FZ.Request { /*$*/var children, resumableState, renderState; children = children$given; resumableState = resumableState$given; renderState = renderState$given; var children$asTask: FZ.Task;/*$*/
  resumableState = new (RequestInstance as FZ.RequestConstructor)(
    resumableState,
    renderState,
    rootFormatContext,
    progressiveChunkSize,
    onError,
    onBrowserBailout,
    onAllReady,
    onShellReady,
    onShellError,
    onFatalError,
    formState
  );
  renderState = createPendingSegment(
    resumableState,
    0,
    null,
    rootFormatContext,
    !1,
    !1
  );
  renderState.parentFlushed = !0;
  children$asTask = createRenderTask(
    resumableState,
    null,
    children,
    -1,
    null,
    renderState,
    null,
    null,
    resumableState.abortableTasks,
    null,
    rootFormatContext,
    null,
    emptyTreeContext,
    null,
    null
  );
  pushComponentStack(children$asTask);
  resumableState.pingedTasks.push(children$asTask);
  return resumableState;
}
function createPrerenderRequest(
  children$given: FZ.ReactNode,
  resumableState: FZ.ResumableState,
  renderState: FZ.RenderState,
  rootFormatContext: FZ.FormatContext,
  progressiveChunkSize: number | undefined,
  onError: FZ.ErrorHandler | undefined,
  onBrowserBailout: FZ.BailoutHandler | undefined,
  onAllReady: (() => void) | undefined,
  onShellReady: (() => void) | undefined,
  onShellError: ((error: FZ.Thrown) => void) | undefined,
  onFatalError: ((error: FZ.Thrown) => void) | undefined
): FZ.Request { /*$*/var children; children = children$given;/*$*/
  children = createRequest(
    children,
    resumableState,
    renderState,
    rootFormatContext,
    progressiveChunkSize,
    onError,
    onBrowserBailout,
    onAllReady,
    onShellReady,
    onShellError,
    onFatalError,
    void 0
  );
  children.trackedPostpones = {
    workingMap: new Map(),
    rootNodes: [],
    rootSlots: null
  };
  return children;
}
function resumeRequest(
  children$given: FZ.ReactNode,
  postponedState: FZ.PostponedStateGiven,
  renderState$given: FZ.RenderState,
  onError$given: FZ.ErrorHandler | undefined,
  onBrowserBailout: FZ.BailoutHandler | undefined,
  onAllReady: (() => void) | undefined,
  onShellReady: (() => void) | undefined,
  onShellError: ((error: FZ.Thrown) => void) | undefined,
  onFatalError: ((error: FZ.Thrown) => void) | undefined
): FZ.Request { /*$*/var children, renderState, onError; children = children$given; renderState = renderState$given; onError = onError$given;/*$*/
  renderState = new (RequestInstance as FZ.RequestConstructor)(
    postponedState.resumableState,
    renderState,
    postponedState.rootFormatContext,
    postponedState.progressiveChunkSize,
    onError,
    onBrowserBailout,
    onAllReady,
    onShellReady,
    onShellError,
    onFatalError,
    null
  );
  renderState.nextSegmentId = postponedState.nextSegmentId as FZ.SegmentId;
  if ("number" === typeof postponedState.replaySlots)
    return (
      (onError = createPendingSegment(
        renderState,
        0,
        null,
        postponedState.rootFormatContext,
        !1,
        !1
      )),
      (onError.parentFlushed = !0),
      (children = createRenderTask(
        renderState,
        null,
        children,
        -1,
        null,
        onError,
        null,
        null,
        renderState.abortableTasks,
        null,
        postponedState.rootFormatContext,
        null,
        emptyTreeContext,
        null,
        null
      )),
      pushComponentStack(children),
      renderState.pingedTasks.push(children),
      renderState
    );
  children = createReplayTask(
    renderState,
    null,
    {
      nodes: postponedState.replayNodes,
      slots: postponedState.replaySlots,
      pendingTasks: 0
    }/*$*/ as FZ.ReplaySet/*$*/,
    children,
    -1,
    null,
    null,
    renderState.abortableTasks,
    null,
    postponedState.rootFormatContext,
    null,
    emptyTreeContext,
    null,
    null
  );
  pushComponentStack(children);
  renderState.pingedTasks.push(children);
  return renderState;
}
function resumeAndPrerenderRequest(
  children$given: FZ.ReactNode,
  postponedState: FZ.PostponedStateGiven,
  renderState: FZ.RenderState,
  onError: FZ.ErrorHandler | undefined,
  onBrowserBailout: FZ.BailoutHandler | undefined,
  onAllReady: (() => void) | undefined,
  onShellReady: (() => void) | undefined,
  onShellError: ((error: FZ.Thrown) => void) | undefined,
  onFatalError: ((error: FZ.Thrown) => void) | undefined
): FZ.Request { /*$*/var children; children = children$given;/*$*/
  children = resumeRequest(
    children,
    postponedState,
    renderState,
    onError,
    onBrowserBailout,
    onAllReady,
    onShellReady,
    onShellError,
    onFatalError
  );
  children.trackedPostpones = {
    workingMap: new Map(),
    rootNodes: [],
    rootSlots: null
  };
  return children;
}
var currentRequest: FZ.Request | null = null;
function pingTask(request: FZ.Request, task: FZ.Task): void {
  request.pingedTasks.push(task);
  1 === request.pingedTasks.length &&
    ((request.flushScheduled = null !== request.destination),
    null !== request.trackedPostpones || 10 === request.status
      ? scheduleMicrotask(function () {
          return performWork(request);
        })
      : setTimeout(function () {
          return performWork(request);
        }, 0));
}
function createSuspenseBoundary(
  request$given: FZ.Request,
  row: FZ.SuspenseListRow | null,
  fallbackAbortableTasks$given: Set<FZ.Task>,
  preamble$given: FZ.BoundaryPreamble | null,
  defer: boolean
): FZ.SuspenseBoundary { /*$*/var request, fallbackAbortableTasks, preamble; request = request$given; fallbackAbortableTasks = fallbackAbortableTasks$given; preamble = preamble$given;/*$*/
  fallbackAbortableTasks = {
    status: 0,
    rootSegmentID: -1,
    parentFlushed: !1,
    pendingTasks: 0,
    row: row,
    completedSegments: [],
    byteSize: 0,
    defer: defer,
    fallbackAbortableTasks: fallbackAbortableTasks,
    errorDigest: null,
    contentState: createHoistableState(),
    fallbackState: createHoistableState(),
    preamble: preamble,
    tracked: null
  }/*$*/ as FZ.SuspenseBoundary/*$*/;
  null !== row &&
    (row.pendingTasks++,
    (preamble = row.boundaries),
    null !== preamble &&
      (request.allPendingTasks++,
      fallbackAbortableTasks.pendingTasks++,
      preamble.push(fallbackAbortableTasks)),
    (request = row.inheritedHoistables),
    null !== request &&
      hoistHoistables(fallbackAbortableTasks.contentState, request));
  return fallbackAbortableTasks;
}
function createRenderTask(
  request: FZ.Request,
  thenableState: FZ.ThenableState | null,
  node: FZ.ReactNode,
  childIndex: FZ.ChildIndex,
  blockedBoundary: FZ.SuspenseBoundary | null,
  blockedSegment: FZ.Segment,
  blockedPreamble: FZ.PreambleState | null,
  hoistableState: FZ.HoistableState | null,
  abortSet: Set<FZ.Task>,
  keyPath: FZ.KeyNode | null,
  formatContext: FZ.FormatContext,
  context: FZ.ContextNode | null,
  treeContext: FZ.TreeContext,
  row: FZ.SuspenseListRow | null,
  componentStack: FZ.ComponentStackNode | null
): FZ.Task {
  request.allPendingTasks++;
  null === blockedBoundary
    ? request.pendingRootTasks++
    : blockedBoundary.pendingTasks++;
  null !== row && row.pendingTasks++;
  var task: FZ.Task = {
    replay: null,
    node: node,
    childIndex: childIndex,
    ping: {
      resolve: function () {
        return pingTask(request, task);
      },
      reject: function (error) {
        request.aborted
          ? task.abortSet.delete(task) &&
            finishAbortedTask(task, request, error)
          : pingTask(request, task);
      }
    },
    blockedBoundary: blockedBoundary,
    blockedSegment: blockedSegment,
    blockedPreamble: blockedPreamble,
    hoistableState: hoistableState,
    abortSet: abortSet,
    keyPath: keyPath,
    formatContext: formatContext,
    context: context,
    treeContext: treeContext,
    row: row,
    componentStack: componentStack,
    thenableState: thenableState
  };
  abortSet.add(task);
  return task;
}
function createReplayTask(
  request: FZ.Request,
  thenableState: FZ.ThenableState | null,
  replay: FZ.ReplaySet,
  node: FZ.ReactNode,
  childIndex: FZ.ChildIndex,
  blockedBoundary: FZ.SuspenseBoundary | null,
  hoistableState: FZ.HoistableState | null,
  abortSet: Set<FZ.Task>,
  keyPath: FZ.KeyNode | null,
  formatContext: FZ.FormatContext,
  context: FZ.ContextNode | null,
  treeContext: FZ.TreeContext,
  row: FZ.SuspenseListRow | null,
  componentStack: FZ.ComponentStackNode | null
): FZ.Task {
  request.allPendingTasks++;
  null === blockedBoundary
    ? request.pendingRootTasks++
    : blockedBoundary.pendingTasks++;
  null !== row && row.pendingTasks++;
  replay.pendingTasks++;
  var task: FZ.Task = {
    replay: replay,
    node: node,
    childIndex: childIndex,
    ping: {
      resolve: function () {
        return pingTask(request, task);
      },
      reject: function (error) {
        request.aborted
          ? task.abortSet.delete(task) &&
            finishAbortedTask(task, request, error)
          : pingTask(request, task);
      }
    },
    blockedBoundary: blockedBoundary,
    blockedSegment: null,
    blockedPreamble: null,
    hoistableState: hoistableState,
    abortSet: abortSet,
    keyPath: keyPath,
    formatContext: formatContext,
    context: context,
    treeContext: treeContext,
    row: row,
    componentStack: componentStack,
    thenableState: thenableState
  };
  abortSet.add(task);
  return task;
}
function createPendingSegment(
  request: FZ.Request,
  index: FZ.ChunkIndex,
  boundary: FZ.SuspenseBoundary | null,
  parentFormatContext: FZ.FormatContext,
  lastPushedText: boolean,
  textEmbedded: boolean
): FZ.Segment {
  return {
    status: 0,
    parentFlushed: !1,
    id: -1,
    index: index,
    chunks: [],
    children: [],
    preambleChildren: [],
    parentFormatContext: parentFormatContext,
    boundary: boundary,
    lastPushedText: lastPushedText,
    textEmbedded: textEmbedded
  };
}
function pushComponentStack(task: FZ.Task): void {
  var node = task.node;
  if ("object" === typeof node && null !== node)
    switch (node.$$typeof) {
      case REACT_ELEMENT_TYPE:
        task.componentStack = { parent: task.componentStack, type: node.type };
    }
}
function replaceSuspenseComponentStackWithSuspenseFallbackStack(
  componentStack: FZ.ComponentStackNode | null
): FZ.ComponentStackNode | null {
  return null === componentStack
    ? null
    : { parent: componentStack.parent, type: "Suspense Fallback" };
}
function getThrownInfo(node$jscomp$0: FZ.ComponentStackNode | null): FZ.ThrownInfo {
  var errorInfo: FZ.ThrownInfo = {};
  node$jscomp$0 &&
    Object.defineProperty(errorInfo, "componentStack", {
      configurable: !0,
      enumerable: !0,
      get: function () {
        try {
          var info = "",
            node: FZ.ComponentStackNode | null = node$jscomp$0;
          do
            (info += describeComponentStackByType(node.type)),
              (node = node.parent);
          while (node);
          var JSCompiler_inline_result = info;
        } catch (x: FZ.Thrown) {
          JSCompiler_inline_result =
            "\nError generating stack: " + x.message + "\n" + x.stack;
        }
        Object.defineProperty(errorInfo, "componentStack", {
          value: JSCompiler_inline_result
        });
        return JSCompiler_inline_result;
      }
    });
  return errorInfo;
}
function logRecoverableError(request$given: FZ.Request, error: FZ.Thrown, errorInfo: FZ.ThrownInfo): FZ.ErrorDigest { /*$*/var request; request = request$given;/*$*/
  if (isRecoverableError(error))
    return (request = request.onBrowserBailout), request(error, errorInfo), "";
  request = request.onError;
  error = request(error, errorInfo);
  if (null == error || "string" === typeof error)
    return "" === error ? void 0 : error;
}
function fatalError(request: FZ.Request, error: FZ.Thrown): void {
  var onShellError = request.onShellError,
    onFatalError = request.onFatalError;
  0 !== request.pendingRootTasks && onShellError(error);
  onFatalError(error);
  endRenderLifetime(request);
  null !== request.destination
    ? ((request.status = 13), closeWithError(request.destination, error))
    : ((request.status = 12), request.aborted || (request.fatalError = error));
}
function finishSuspenseListRow(request: FZ.Request, row: FZ.SuspenseListRow): void {
  unblockSuspenseListRow(request, row.next, row.hoistables);
}
function unblockSuspenseListRow(request: FZ.Request, unblockedRow: FZ.SuspenseListRow | null, inheritedHoistables: FZ.HoistableState | null): void {
  for (; null !== unblockedRow; ) {
    null !== inheritedHoistables &&
      (hoistHoistables(unblockedRow.hoistables, inheritedHoistables),
      (unblockedRow.inheritedHoistables = inheritedHoistables));
    var unblockedBoundaries = unblockedRow.boundaries;
    if (null !== unblockedBoundaries) {
      unblockedRow.boundaries = null;
      for (var i = 0; i < unblockedBoundaries.length; i++) {
        var unblockedBoundary = unblockedBoundaries[i];
        null !== inheritedHoistables &&
          hoistHoistables(unblockedBoundary.contentState, inheritedHoistables);
        finishedTask(request, unblockedBoundary, null, null);
      }
    }
    unblockedRow.pendingTasks--;
    if (0 < unblockedRow.pendingTasks) break;
    inheritedHoistables = unblockedRow.hoistables;
    unblockedRow = unblockedRow.next;
  }
}
function tryToResolveTogetherRow(request: FZ.Request, togetherRow: FZ.SuspenseListRow): void {
  var boundaries = togetherRow.boundaries;
  if (null !== boundaries && togetherRow.pendingTasks === boundaries.length) {
    for (var allCompleteAndInlinable = !0, i = 0; i < boundaries.length; i++) {
      var rowBoundary = boundaries[i];
      if (
        1 !== rowBoundary.pendingTasks ||
        rowBoundary.parentFlushed ||
        isEligibleForOutlining(request, rowBoundary)
      ) {
        allCompleteAndInlinable = !1;
        break;
      }
    }
    allCompleteAndInlinable &&
      unblockSuspenseListRow(request, togetherRow, togetherRow.hoistables);
  }
}
function createSuspenseListRow(previousRow: FZ.SuspenseListRow | null): FZ.SuspenseListRow {
  var newRow: FZ.SuspenseListRow = {
    pendingTasks: 1,
    boundaries: null,
    hoistables: createHoistableState(),
    inheritedHoistables: null,
    together: !1,
    next: null
  };
  null !== previousRow &&
    0 < previousRow.pendingTasks &&
    (newRow.pendingTasks++,
    (newRow.boundaries = []),
    (previousRow.next = newRow));
  return newRow;
}
function renderSuspenseListRows(request: FZ.Request, task: FZ.Task, keyPath$given: FZ.KeyNode, rows: FZ.ReactNode, revealOrder$given: FZ.PropValue): void { /*$*/var keyPath, revealOrder; keyPath = keyPath$given; revealOrder = revealOrder$given;/*$*/ /*$*/var resumeSlots$asNode: FZ.ReactNode;/*$*/ /*$*/var resumeSlots$asSegment: FZ.Segment;/*$*/ /*$*/var i$asNode: FZ.ReactNode;/*$*/ /*$*/var node$asIndex: number;/*$*/
  var prevKeyPath = task.keyPath,
    prevTreeContext = task.treeContext,
    prevRow = task.row;
  task.keyPath = keyPath;
  keyPath = rows.length;
  var previousSuspenseListRow: FZ.SuspenseListRow | null = null;
  if (null !== task.replay) {
    var resumeSlots = task.replay.slots;
    if (null !== resumeSlots && "object" === typeof resumeSlots)
      for (var n = 0; n < keyPath; n++) {
        var i =
            "backwards" !== revealOrder &&
            "unstable_legacy-backwards" !== revealOrder
              ? n
              : keyPath - 1 - n,
          node = rows[i];
        task.row = previousSuspenseListRow = createSuspenseListRow(
          previousSuspenseListRow
        );
        task.treeContext = pushTreeContext(prevTreeContext, keyPath as FZ.int32, i);
        var resumeSegmentID: FZ.SegmentId | undefined = resumeSlots[i];
        "number" === typeof resumeSegmentID
          ? (resumeNode(request, task, resumeSegmentID as FZ.SegmentId, node, i as FZ.ChildIndex),
            delete resumeSlots[i])
          : renderNode(request, task, node, i as FZ.ChildIndex);
        0 === --previousSuspenseListRow.pendingTasks &&
          finishSuspenseListRow(request, previousSuspenseListRow);
      }
    else
      for (resumeSlots = 0; resumeSlots < keyPath; resumeSlots++)
        (n =
          "backwards" !== revealOrder &&
          "unstable_legacy-backwards" !== revealOrder
            ? resumeSlots
            : keyPath - 1 - resumeSlots),
          (i$asNode = rows[n]),
          (task.row = previousSuspenseListRow =
            createSuspenseListRow(previousSuspenseListRow)),
          (task.treeContext = pushTreeContext(prevTreeContext, keyPath as FZ.int32, n)),
          renderNode(request, task, i$asNode, n as FZ.ChildIndex),
          0 === --previousSuspenseListRow.pendingTasks &&
            finishSuspenseListRow(request, previousSuspenseListRow);
  } else if (
    "backwards" !== revealOrder &&
    "unstable_legacy-backwards" !== revealOrder
  )
    for (revealOrder = 0; revealOrder < keyPath; revealOrder++)
      (resumeSlots$asNode = rows[revealOrder]),
        (task.row = previousSuspenseListRow =
          createSuspenseListRow(previousSuspenseListRow)),
        (task.treeContext = pushTreeContext(
          prevTreeContext,
          keyPath as FZ.int32,
          revealOrder
        )),
        renderNode(request, task, resumeSlots$asNode, revealOrder as FZ.ChildIndex),
        0 === --previousSuspenseListRow.pendingTasks &&
          finishSuspenseListRow(request, previousSuspenseListRow);
  else {
    resumeSlots$asSegment = task.blockedSegment!;
    n = resumeSlots$asSegment.children.length;
    i = resumeSlots$asSegment.chunks.length;
    for (node$asIndex = 0; node$asIndex < keyPath; node$asIndex++) {
      resumeSegmentID =
        "unstable_legacy-backwards" === revealOrder ? keyPath - 1 - node$asIndex : node$asIndex;
      var node$40 = rows[resumeSegmentID];
      task.row = previousSuspenseListRow = createSuspenseListRow(
        previousSuspenseListRow
      );
      task.treeContext = pushTreeContext(
        prevTreeContext,
        keyPath as FZ.int32,
        resumeSegmentID
      );
      var newSegment = createPendingSegment(
        request,
        i as FZ.ChunkIndex,
        null,
        task.formatContext,
        0 === resumeSegmentID ? resumeSlots$asSegment.lastPushedText : !0,
        !0
      );
      resumeSlots$asSegment.children.splice(n, 0, newSegment);
      task.blockedSegment = newSegment;
      try {
        renderNode(request, task, node$40, resumeSegmentID as FZ.ChildIndex),
          pushSegmentFinale(
            newSegment.chunks,
            request.renderState,
            newSegment.lastPushedText,
            newSegment.textEmbedded
          ),
          (newSegment.status = 1),
          finishedSegment(request, task.blockedBoundary, newSegment),
          0 === --previousSuspenseListRow.pendingTasks &&
            finishSuspenseListRow(request, previousSuspenseListRow);
      } catch (thrownValue: FZ.Thrown) {
        throw ((newSegment.status = request.aborted ? 3 : 4), thrownValue);
      }
    }
    task.blockedSegment = resumeSlots$asSegment;
    resumeSlots$asSegment.lastPushedText = !1;
  }
  null !== prevRow &&
    null !== previousSuspenseListRow &&
    0 < previousSuspenseListRow.pendingTasks &&
    (prevRow.pendingTasks++, (previousSuspenseListRow.next = prevRow));
  task.treeContext = prevTreeContext;
  task.row = prevRow;
  task.keyPath = prevKeyPath;
}
function renderWithHooks(request$given: FZ.Request, task: FZ.Task, keyPath: FZ.KeyNode, Component: FZ.FunctionComponent, props: FZ.Props, secondArg: FZ.Ref): FZ.ReactNode { /*$*/var request; request = request$given;/*$*/
  var prevThenableState = task.thenableState;
  task.thenableState = null;
  currentlyRenderingComponent = {};
  currentlyRenderingTask = task;
  currentlyRenderingRequest = request;
  currentlyRenderingKeyPath = keyPath;
  actionStateCounter = localIdCounter = 0;
  actionStateMatchingIndex = -1;
  thenableIndexCounter = 0;
  thenableState = prevThenableState;
  for (request = Component(props, secondArg); didScheduleRenderPhaseUpdate; )
    (didScheduleRenderPhaseUpdate = !1),
      (actionStateCounter = localIdCounter = 0),
      (actionStateMatchingIndex = -1),
      (thenableIndexCounter = 0),
      (numberOfReRenders += 1),
      (workInProgressHook = null),
      (request = Component(props, secondArg));
  resetHooksState();
  return request;
}
function finishFunctionComponent(
  request: FZ.Request,
  task: FZ.Task,
  keyPath$given: FZ.KeyNode,
  children: FZ.ReactNode,
  hasId: boolean,
  actionStateCount$given: FZ.HookCounter,
  actionStateMatchingIndex: FZ.HookCounter
): void { /*$*/var keyPath, actionStateCount; keyPath = keyPath$given; actionStateCount = actionStateCount$given;/*$*/ /*$*/var segment$asChunks: FZ.Chunk[];/*$*/
  var didEmitActionStateMarkers = !1;
  if (0 !== actionStateCount && null !== request.formState) {
    var segment = task.blockedSegment;
    if (null !== segment) {
      didEmitActionStateMarkers = !0;
      segment$asChunks = segment.chunks;
      for (var i = 0; i < actionStateCount; i++)
        i === actionStateMatchingIndex
          ? segment$asChunks.push("\x3c!--F!--\x3e")
          : segment$asChunks.push("\x3c!--F--\x3e");
    }
  }
  actionStateCount = task.keyPath;
  task.keyPath = keyPath;
  hasId
    ? ((keyPath = task.treeContext),
      (task.treeContext = pushTreeContext(keyPath, 1, 0)),
      renderNode(request, task, children, -1),
      (task.treeContext = keyPath))
    : didEmitActionStateMarkers
      ? renderNode(request, task, children, -1)
      : renderNodeDestructive(request, task, children, -1);
  task.keyPath = actionStateCount;
}
function renderElement(request: FZ.Request, task: FZ.Task, keyPath: FZ.KeyNode, type: FZ.ElementType, props: FZ.Props, ref: FZ.Ref): void {
  if ("function" === typeof type)
    if (type.prototype && type.prototype.isReactComponent) {
      var newProps: FZ.PropsBag = props;
      if ("ref" in props) {
        newProps = {};
        for (var propName in props)
          "ref" !== propName && (newProps[propName] = props[propName]);
      }
      var defaultProps = type.defaultProps;
      if (defaultProps) {
        newProps === props && (newProps = assign({}, newProps, props));
        for (var propName$45 in defaultProps)
          void 0 === newProps[propName$45] &&
            (newProps[propName$45] = defaultProps[propName$45]);
      }
      var JSCompiler_inline_result = newProps;
      var context: FZ.ContextValue = emptyContextObject,
        contextType = type.contextType;
      "object" === typeof contextType &&
        null !== contextType &&
        (context = contextType._currentValue);
      var JSCompiler_inline_result$jscomp$0 = new type(
        JSCompiler_inline_result,
        context
      );
      var initialState =
        void 0 !== JSCompiler_inline_result$jscomp$0.state
          ? JSCompiler_inline_result$jscomp$0.state
          : null;
      JSCompiler_inline_result$jscomp$0.updater = classComponentUpdater;
      JSCompiler_inline_result$jscomp$0.props = JSCompiler_inline_result;
      JSCompiler_inline_result$jscomp$0.state = initialState;
      var internalInstance: FZ.InternalInstance = { queue: [], replace: !1 };
      JSCompiler_inline_result$jscomp$0._reactInternals = internalInstance;
      var contextType$jscomp$0 = type.contextType;
      JSCompiler_inline_result$jscomp$0.context =
        "object" === typeof contextType$jscomp$0 &&
        null !== contextType$jscomp$0
          ? contextType$jscomp$0._currentValue
          : emptyContextObject;
      var getDerivedStateFromProps = type.getDerivedStateFromProps;
      if ("function" === typeof getDerivedStateFromProps) {
        var partialState = getDerivedStateFromProps(
          JSCompiler_inline_result,
          initialState
        );
        var JSCompiler_inline_result$jscomp$1 =
          null === partialState || void 0 === partialState
            ? initialState
            : assign({}, initialState, partialState);
        JSCompiler_inline_result$jscomp$0.state =
          JSCompiler_inline_result$jscomp$1;
      }
      if (
        "function" !== typeof type.getDerivedStateFromProps &&
        "function" !==
          typeof JSCompiler_inline_result$jscomp$0.getSnapshotBeforeUpdate &&
        ("function" ===
          typeof JSCompiler_inline_result$jscomp$0.UNSAFE_componentWillMount ||
          "function" ===
            typeof JSCompiler_inline_result$jscomp$0.componentWillMount)
      ) {
        var oldState = JSCompiler_inline_result$jscomp$0.state;
        "function" ===
          typeof JSCompiler_inline_result$jscomp$0.componentWillMount &&
          JSCompiler_inline_result$jscomp$0.componentWillMount();
        "function" ===
          typeof JSCompiler_inline_result$jscomp$0.UNSAFE_componentWillMount &&
          JSCompiler_inline_result$jscomp$0.UNSAFE_componentWillMount();
        oldState !== JSCompiler_inline_result$jscomp$0.state &&
          classComponentUpdater.enqueueReplaceState(
            JSCompiler_inline_result$jscomp$0,
            JSCompiler_inline_result$jscomp$0.state,
            null
          );
        if (
          null !== internalInstance.queue &&
          0 < internalInstance.queue.length
        ) {
          var oldQueue = internalInstance.queue,
            oldReplace = internalInstance.replace;
          internalInstance.queue = null;
          internalInstance.replace = !1;
          if (oldReplace && 1 === oldQueue.length)
            JSCompiler_inline_result$jscomp$0.state = oldQueue[0];
          else {
            for (
              var nextState = oldReplace
                  ? oldQueue[0]
                  : JSCompiler_inline_result$jscomp$0.state,
                dontMutate = !0,
                i = oldReplace ? 1 : 0;
              i < oldQueue.length;
              i++
            ) {
              var partial = oldQueue[i],
                partialState$jscomp$0 =
                  "function" === typeof partial
                    ? partial.call(
                        JSCompiler_inline_result$jscomp$0,
                        nextState,
                        JSCompiler_inline_result,
                        void 0
                      )
                    : partial;
              null != partialState$jscomp$0 &&
                (dontMutate
                  ? ((dontMutate = !1),
                    (nextState = assign({}, nextState, partialState$jscomp$0)))
                  : assign(nextState, partialState$jscomp$0));
            }
            JSCompiler_inline_result$jscomp$0.state = nextState;
          }
        } else internalInstance.queue = null;
      }
      var nextChildren = JSCompiler_inline_result$jscomp$0.render();
      if (request.aborted) throw null;
      var prevKeyPath = task.keyPath;
      task.keyPath = keyPath;
      renderNodeDestructive(request, task, nextChildren, -1);
      task.keyPath = prevKeyPath;
    } else {
      var value = renderWithHooks(request, task, keyPath, type, props, void 0);
      if (request.aborted) throw null;
      finishFunctionComponent(
        request,
        task,
        keyPath,
        value,
        0 !== localIdCounter,
        actionStateCounter as FZ.HookCounter,
        actionStateMatchingIndex
      );
    }
  else if ("string" === typeof type) {
    var segment = task.blockedSegment;
    if (null === segment) {
      var children = props.children,
        prevContext = task.formatContext,
        prevKeyPath$jscomp$0 = task.keyPath;
      task.formatContext = getChildFormatContext(prevContext, type, props);
      task.keyPath = keyPath;
      renderNode(request, task, children, -1);
      task.formatContext = prevContext;
      task.keyPath = prevKeyPath$jscomp$0;
    } else {
      var children$42 = pushStartInstance(
        segment.chunks,
        type,
        props,
        request.resumableState,
        request.renderState,
        task.blockedPreamble,
        task.hoistableState,
        task.formatContext,
        segment.lastPushedText
      );
      segment.lastPushedText = !1;
      var prevContext$43 = task.formatContext,
        prevKeyPath$44 = task.keyPath;
      task.keyPath = keyPath;
      if (
        3 ===
        (task.formatContext = getChildFormatContext(
          prevContext$43,
          type,
          props
        )).insertionMode
      ) {
        var preambleSegment = createPendingSegment(
          request,
          0,
          null,
          task.formatContext,
          !1,
          !1
        );
        segment.preambleChildren.push(preambleSegment);
        task.blockedSegment = preambleSegment;
        try {
          renderNode(request, task, children$42, -1),
            pushSegmentFinale(
              preambleSegment.chunks,
              request.renderState,
              preambleSegment.lastPushedText,
              preambleSegment.textEmbedded
            ),
            (preambleSegment.status = 1),
            finishedSegment(request, task.blockedBoundary, preambleSegment);
        } finally {
          task.blockedSegment = segment;
        }
      } else renderNode(request, task, children$42, -1);
      task.formatContext = prevContext$43;
      task.keyPath = prevKeyPath$44;
      a: {
        var target = segment.chunks,
          resumableState = request.resumableState;
        switch (type) {
          case "title":
          case "style":
          case "script":
          case "area":
          case "base":
          case "br":
          case "col":
          case "embed":
          case "hr":
          case "img":
          case "input":
          case "keygen":
          case "link":
          case "meta":
          case "param":
          case "source":
          case "track":
          case "wbr":
            break a;
          case "body":
            if (1 >= prevContext$43.insertionMode) {
              resumableState.hasBody = !0;
              break a;
            }
            break;
          case "html":
            if (0 === prevContext$43.insertionMode) {
              resumableState.hasHtml = !0;
              break a;
            }
            break;
          case "head":
            if (1 >= prevContext$43.insertionMode) break a;
        }
        target.push(endChunkForTag(type));
      }
      segment.lastPushedText = !1;
    }
  } else {
    switch (type) {
      case REACT_LEGACY_HIDDEN_TYPE:
      case REACT_STRICT_MODE_TYPE:
      case REACT_PROFILER_TYPE:
      case REACT_FRAGMENT_TYPE:
        var prevKeyPath$jscomp$1 = task.keyPath;
        task.keyPath = keyPath;
        renderNodeDestructive(request, task, props.children, -1);
        task.keyPath = prevKeyPath$jscomp$1;
        return;
      case REACT_ACTIVITY_TYPE:
        var segment$jscomp$0 = task.blockedSegment;
        if (null === segment$jscomp$0) {
          if ("hidden" !== props.mode) {
            var prevKeyPath$jscomp$2 = task.keyPath;
            task.keyPath = keyPath;
            renderNode(request, task, props.children, -1);
            task.keyPath = prevKeyPath$jscomp$2;
          }
        } else if ("hidden" !== props.mode) {
          segment$jscomp$0.chunks.push("\x3c!--&--\x3e");
          segment$jscomp$0.lastPushedText = !1;
          var prevKeyPath$47 = task.keyPath;
          task.keyPath = keyPath;
          renderNode(request, task, props.children, -1);
          task.keyPath = prevKeyPath$47;
          segment$jscomp$0.chunks.push("\x3c!--/&--\x3e");
          segment$jscomp$0.lastPushedText = !1;
        }
        return;
      case REACT_SUSPENSE_LIST_TYPE:
        a: {
          var children$jscomp$0 = props.children,
            revealOrder = props.revealOrder;
          if ("independent" !== revealOrder && "together" !== revealOrder) {
            if (isArrayImpl(children$jscomp$0)) {
              renderSuspenseListRows(
                request,
                task,
                keyPath,
                children$jscomp$0,
                revealOrder
              );
              break a;
            }
            var iteratorFn = getIteratorFn(children$jscomp$0);
            if (iteratorFn) {
              var iterator = iteratorFn.call(children$jscomp$0);
              if (iterator) {
                var step = iterator.next();
                if (!step.done) {
                  do step = iterator.next();
                  while (!step.done);
                  renderSuspenseListRows(
                    request,
                    task,
                    keyPath,
                    children$jscomp$0,
                    revealOrder
                  );
                }
                break a;
              }
            }
          }
          if ("together" === revealOrder) {
            var prevKeyPath$41 = task.keyPath,
              prevRow = task.row,
              newRow = (task.row = createSuspenseListRow(null));
            newRow.boundaries = [];
            newRow.together = !0;
            task.keyPath = keyPath;
            renderNodeDestructive(request, task, children$jscomp$0, -1);
            0 === --newRow.pendingTasks &&
              finishSuspenseListRow(request, newRow);
            task.keyPath = prevKeyPath$41;
            task.row = prevRow;
            null !== prevRow &&
              0 < newRow.pendingTasks &&
              (prevRow.pendingTasks++, (newRow.next = prevRow));
          } else {
            var prevKeyPath$jscomp$3 = task.keyPath;
            task.keyPath = keyPath;
            renderNodeDestructive(request, task, children$jscomp$0, -1);
            task.keyPath = prevKeyPath$jscomp$3;
          }
        }
        return;
      case REACT_VIEW_TRANSITION_TYPE:
        var prevContext$jscomp$0 = task.formatContext,
          prevKeyPath$jscomp$4 = task.keyPath;
        var resumableState$jscomp$0 = request.resumableState;
        if (null != props.name && "auto" !== props.name)
          var JSCompiler_inline_result$jscomp$2 = props.name;
        else {
          var treeId = getTreeId(task.treeContext);
          JSCompiler_inline_result$jscomp$2 = makeId(
            resumableState$jscomp$0,
            treeId,
            0
          );
        }
        var autoName = JSCompiler_inline_result$jscomp$2,
          resumableState$jscomp$1 = request.resumableState,
          update = getViewTransitionClassName(props.default, props.update),
          enter = getViewTransitionClassName(props.default, props.enter),
          exit = getViewTransitionClassName(props.default, props.exit),
          share = getViewTransitionClassName(props.default, props.share),
          name = props.name;
        null == update && (update = "auto");
        null == enter && (enter = "auto");
        null == exit && (exit = "auto");
        if (null == name) {
          var parentViewTransition = prevContext$jscomp$0.viewTransition;
          null !== parentViewTransition
            ? ((name = parentViewTransition.name),
              (share = parentViewTransition.share))
            : ((name = "auto"), (share = "none"));
        } else
          null == share && (share = "auto"),
            prevContext$jscomp$0.tagScope & 4 &&
              (resumableState$jscomp$1.instructions |= 128);
        prevContext$jscomp$0.tagScope & 8
          ? (resumableState$jscomp$1.instructions |= 128)
          : (exit = "none");
        prevContext$jscomp$0.tagScope & 16
          ? (resumableState$jscomp$1.instructions |= 128)
          : (enter = "none");
        var viewTransition: FZ.ViewTransitionContext = {
            update: update,
            enter: enter,
            exit: exit,
            share: share,
            parentEnter: "none",
            parentExit: "none",
            name: name,
            autoName: autoName,
            nameIdx: 0
          },
          subtreeScope = prevContext$jscomp$0.tagScope & -25;
        subtreeScope =
          "none" !== update ? subtreeScope | 32 : subtreeScope & -33;
        "none" !== enter && (subtreeScope |= 64);
        var JSCompiler_inline_result$jscomp$3 = createFormatContext(
          prevContext$jscomp$0.insertionMode,
          prevContext$jscomp$0.selectedValue,
          subtreeScope,
          viewTransition
        );
        task.formatContext = JSCompiler_inline_result$jscomp$3;
        task.keyPath = keyPath;
        if (null != props.name && "auto" !== props.name)
          renderNodeDestructive(request, task, props.children, -1);
        else {
          var prevTreeContext = task.treeContext;
          task.treeContext = pushTreeContext(prevTreeContext, 1, 0);
          renderNode(request, task, props.children, -1);
          task.treeContext = prevTreeContext;
        }
        task.formatContext = prevContext$jscomp$0;
        task.keyPath = prevKeyPath$jscomp$4;
        return;
      case REACT_SCOPE_TYPE:
        throw Error("ReactDOMServer does not yet support scope components.");
      case REACT_SUSPENSE_TYPE:
        a: if (null !== task.replay) {
          var prevKeyPath$27 = task.keyPath,
            prevContext$28 = task.formatContext,
            prevRow$29 = task.row;
          task.keyPath = keyPath;
          task.formatContext = getSuspenseContentFormatContext(
            request.resumableState,
            prevContext$28
          );
          task.row = null;
          var content$30 = props.children;
          try {
            renderNode(request, task, content$30, -1);
          } finally {
            (task.keyPath = prevKeyPath$27),
              (task.formatContext = prevContext$28),
              (task.row = prevRow$29);
          }
        } else {
          var prevKeyPath$jscomp$5 = task.keyPath,
            prevContext$jscomp$1 = task.formatContext,
            prevRow$jscomp$0 = task.row,
            parentBoundary = task.blockedBoundary,
            parentPreamble = task.blockedPreamble,
            parentHoistableState = task.hoistableState,
            parentSegment = task.blockedSegment!,
            fallback = props.fallback,
            content = props.children,
            fallbackAbortSet = new Set<FZ.Task>(),
            newBoundary = createSuspenseBoundary(
              request,
              task.row,
              fallbackAbortSet,
              2 > task.formatContext.insertionMode
                ? {
                    content: createPreambleState(),
                    fallback: createPreambleState()
                  }/*$*/ as FZ.BoundaryPreamble/*$*/
                : null,
              !1
            ),
            boundarySegment = createPendingSegment(
              request,
              parentSegment.chunks.length as FZ.ChunkIndex,
              newBoundary,
              task.formatContext,
              !1,
              !1
            );
          parentSegment.children.push(boundarySegment);
          parentSegment.lastPushedText = !1;
          var contentRootSegment = createPendingSegment(
            request,
            0,
            null,
            task.formatContext,
            !1,
            !1
          );
          contentRootSegment.parentFlushed = !0;
          var trackedPostpones = request.trackedPostpones;
          if (null !== trackedPostpones) {
            var suspenseComponentStack = task.componentStack,
              fallbackKeyPath: FZ.KeyNode = [keyPath[0], "Suspense Fallback", keyPath[2]];
            if (null !== trackedPostpones) {
              var fallbackReplayNode: FZ.ReplayNode = [
                fallbackKeyPath[1],
                fallbackKeyPath[2],
                [],
                null
              ];
              trackedPostpones.workingMap.set(
                fallbackKeyPath,
                fallbackReplayNode
              );
              newBoundary.tracked = {
                contentKeyPath: keyPath,
                fallbackNode: fallbackReplayNode
              };
            }
            task.blockedSegment = boundarySegment;
            task.blockedPreamble =
              null === newBoundary.preamble
                ? null
                : newBoundary.preamble.fallback;
            task.keyPath = fallbackKeyPath;
            task.formatContext = getSuspenseFallbackFormatContext(
              request.resumableState,
              prevContext$jscomp$1
            );
            task.componentStack =
              replaceSuspenseComponentStackWithSuspenseFallbackStack(
                suspenseComponentStack
              );
            try {
              renderNode(request, task, fallback, -1),
                pushSegmentFinale(
                  boundarySegment.chunks,
                  request.renderState,
                  boundarySegment.lastPushedText,
                  boundarySegment.textEmbedded
                ),
                (boundarySegment.status = 1),
                finishedSegment(request, parentBoundary, boundarySegment);
            } catch (thrownValue: FZ.Thrown) {
              throw (
                ((boundarySegment.status = request.aborted ? 3 : 4),
                thrownValue)
              );
            } finally {
              (task.blockedSegment = parentSegment),
                (task.blockedPreamble = parentPreamble),
                (task.keyPath = prevKeyPath$jscomp$5),
                (task.formatContext = prevContext$jscomp$1);
            }
            var suspendedPrimaryTask = createRenderTask(
              request,
              null,
              content,
              -1,
              newBoundary,
              contentRootSegment,
              null === newBoundary.preamble
                ? null
                : newBoundary.preamble.content,
              newBoundary.contentState,
              task.abortSet,
              keyPath,
              getSuspenseContentFormatContext(
                request.resumableState,
                task.formatContext
              ),
              task.context,
              task.treeContext,
              null,
              suspenseComponentStack
            );
            pushComponentStack(suspendedPrimaryTask);
            request.pingedTasks.push(suspendedPrimaryTask);
          } else {
            task.blockedBoundary = newBoundary;
            task.blockedPreamble =
              null === newBoundary.preamble
                ? null
                : newBoundary.preamble.content;
            task.hoistableState = newBoundary.contentState;
            task.blockedSegment = contentRootSegment;
            task.keyPath = keyPath;
            task.formatContext = getSuspenseContentFormatContext(
              request.resumableState,
              prevContext$jscomp$1
            );
            task.row = null;
            try {
              if (
                (renderNode(request, task, content, -1),
                pushSegmentFinale(
                  contentRootSegment.chunks,
                  request.renderState,
                  contentRootSegment.lastPushedText,
                  contentRootSegment.textEmbedded
                ),
                (contentRootSegment.status = 1),
                finishedSegment(request, newBoundary, contentRootSegment),
                queueCompletedSegment(newBoundary, contentRootSegment),
                0 === newBoundary.pendingTasks && 0 === newBoundary.status)
              ) {
                if (
                  ((newBoundary.status = 1),
                  !isEligibleForOutlining(request, newBoundary))
                ) {
                  null !== prevRow$jscomp$0 &&
                    0 === --prevRow$jscomp$0.pendingTasks &&
                    finishSuspenseListRow(request, prevRow$jscomp$0);
                  0 === request.pendingRootTasks &&
                    task.blockedPreamble &&
                    preparePreamble(request);
                  break a;
                }
              } else
                null !== prevRow$jscomp$0 &&
                  prevRow$jscomp$0.together &&
                  tryToResolveTogetherRow(request, prevRow$jscomp$0);
            } catch (thrownValue$31: FZ.Thrown) {
              newBoundary.status = 4;
              if (request.aborted) {
                contentRootSegment.status = 3;
                var error = request.fatalError;
              } else (contentRootSegment.status = 4), (error = thrownValue$31);
              var thrownInfo = getThrownInfo(task.componentStack),
                errorDigest = logRecoverableError(request, error, thrownInfo);
              newBoundary.errorDigest = errorDigest;
              untrackBoundary(request, newBoundary);
            } finally {
              (task.blockedBoundary = parentBoundary),
                (task.blockedPreamble = parentPreamble),
                (task.hoistableState = parentHoistableState),
                (task.blockedSegment = parentSegment),
                (task.keyPath = prevKeyPath$jscomp$5),
                (task.formatContext = prevContext$jscomp$1),
                (task.row = prevRow$jscomp$0);
            }
            var suspendedFallbackTask = createRenderTask(
              request,
              null,
              fallback,
              -1,
              parentBoundary,
              boundarySegment,
              null === newBoundary.preamble
                ? null
                : newBoundary.preamble.fallback,
              newBoundary.fallbackState,
              fallbackAbortSet,
              [keyPath[0], "Suspense Fallback", keyPath[2]],
              getSuspenseFallbackFormatContext(
                request.resumableState,
                task.formatContext
              ),
              task.context,
              task.treeContext,
              task.row,
              replaceSuspenseComponentStackWithSuspenseFallbackStack(
                task.componentStack
              )
            );
            pushComponentStack(suspendedFallbackTask);
            request.pingedTasks.push(suspendedFallbackTask);
          }
        }
        return;
    }
    if ("object" === typeof type && null !== type)
      switch (type.$$typeof) {
        case REACT_FORWARD_REF_TYPE:
          if ("ref" in props) {
            var propsWithoutRef: FZ.PropsBag = {};
            for (var key in props)
              "ref" !== key && (propsWithoutRef[key] = props[key]);
          } else propsWithoutRef = props;
          var children$jscomp$1 = renderWithHooks(
            request,
            task,
            keyPath,
            type.render,
            propsWithoutRef,
            ref
          );
          finishFunctionComponent(
            request,
            task,
            keyPath,
            children$jscomp$1,
            0 !== localIdCounter,
            actionStateCounter as FZ.HookCounter,
            actionStateMatchingIndex
          );
          return;
        case REACT_MEMO_TYPE:
          renderElement(request, task, keyPath, type.type, props, ref);
          return;
        case REACT_CONTEXT_TYPE:
          var children$jscomp$2 = props.children,
            prevKeyPath$jscomp$6 = task.keyPath,
            nextValue = props.value;
          var prevValue = type._currentValue;
          type._currentValue = nextValue;
          var prevNode = currentActiveSnapshot,
            newNode: FZ.ContextNode = {
              parent: prevNode,
              depth: (null === prevNode ? 0 : prevNode.depth + 1) as FZ.ContextDepth,
              context: type,
              parentValue: prevValue,
              value: nextValue
            };
          currentActiveSnapshot = newNode;
          task.context = newNode;
          task.keyPath = keyPath;
          renderNodeDestructive(request, task, children$jscomp$2, -1);
          var prevSnapshot: FZ.ContextNode | null = currentActiveSnapshot;
          if (null === prevSnapshot)
            throw Error(
              "Tried to pop a Context at the root of the app. This is a bug in React."
            );
          prevSnapshot.context._currentValue = prevSnapshot.parentValue;
          var JSCompiler_inline_result$jscomp$4 = (currentActiveSnapshot =
            prevSnapshot.parent);
          task.context = JSCompiler_inline_result$jscomp$4;
          task.keyPath = prevKeyPath$jscomp$6;
          return;
        case REACT_CONSUMER_TYPE:
          var render = props.children,
            newChildren = render(type._context._currentValue),
            prevKeyPath$jscomp$7 = task.keyPath;
          task.keyPath = keyPath;
          renderNodeDestructive(request, task, newChildren, -1);
          task.keyPath = prevKeyPath$jscomp$7;
          return;
        case REACT_LAZY_TYPE:
          var init = type._init;
          var Component = init(type._payload);
          if (request.aborted) throw null;
          renderElement(request, task, keyPath, Component, props, ref);
          return;
      }
    throw Error(
      "Element type is invalid: expected a string (for built-in components) or a class/function (for composite components) but got: " +
        ((null == type ? type : typeof type) + ".")
    );
  }
}
function resumeNode(request: FZ.Request, task: FZ.Task, segmentId: FZ.SegmentId, node: FZ.ReactNode, childIndex: FZ.ChildIndex): void {
  var prevReplay = task.replay,
    blockedBoundary = task.blockedBoundary,
    resumedSegment = createPendingSegment(
      request,
      0,
      null,
      task.formatContext,
      !1,
      !1
    );
  resumedSegment.id = segmentId;
  resumedSegment.parentFlushed = !0;
  try {
    (task.replay = null),
      (task.blockedSegment = resumedSegment),
      renderNode(request, task, node, childIndex),
      (resumedSegment.status = 1),
      finishedSegment(request, blockedBoundary, resumedSegment),
      null === blockedBoundary
        ? (request.completedRootSegment = resumedSegment)
        : (queueCompletedSegment(blockedBoundary, resumedSegment),
          blockedBoundary.parentFlushed &&
            request.partialBoundaries.push(blockedBoundary));
  } finally {
    (task.replay = prevReplay), (task.blockedSegment = null);
  }
}
function renderNodeDestructive(request: FZ.Request, task: FZ.Task, node$given: FZ.ReactNode, childIndex: FZ.ChildIndex): void { /*$*/var node; node = node$given;/*$*/
  null !== task.replay && "number" === typeof task.replay.slots
    ? resumeNode(request, task, task.replay.slots as FZ.SegmentId, node, childIndex)
    : ((task.node = node),
      (task.childIndex = childIndex),
      (node = task.componentStack),
      pushComponentStack(task),
      retryNode(request, task),
      (task.componentStack = node));
}
function retryNode(request$given: FZ.Request, task: FZ.Task): void { /*$*/var request: FZ.Request; request = request$given; var request$asError: FZ.Thrown;/*$*/ /*$*/var node$asIndex: number;/*$*/ /*$*/var childIndex$asNodes: FZ.ReplayNode[];/*$*/ /*$*/var childIndex$asString: string;/*$*/ /*$*/var childIndex$asSegment: FZ.Segment | null;/*$*/ /*$*/var key$asKeyPath: FZ.KeyNode;/*$*/ /*$*/var key$asInfo: FZ.ThrownInfo;/*$*/ /*$*/var key$asDigest: FZ.ErrorDigest;/*$*/ /*$*/var type$asNodes: FZ.ReplayNode[];/*$*/ /*$*/var props$asBoundary: FZ.SuspenseBoundary | null;/*$*/ /*$*/var ref$asSlots: FZ.ResumeSlots;/*$*/ /*$*/var name$asNodes: FZ.ReplayNode[];/*$*/ /*$*/var keyOrIndex$asKeyPath: FZ.KeyNode | null;/*$*/ /*$*/var replay$asId: FZ.SegmentId;/*$*/ /*$*/var node$jscomp$0$asSlots: FZ.ResumeSlots;/*$*/ /*$*/var childNodes$asThrown: FZ.Thrown;/*$*/ /*$*/var childNodes$asTask: FZ.Task;/*$*/ /*$*/var childNodes$asInit: FZ.GivenFunction;/*$*/ /*$*/var childNodes$asIterator: FZ.IteratorFn;/*$*/ /*$*/var childSlots$asInfo: FZ.ThrownInfo;/*$*/ /*$*/var childSlots$asChildren: FZ.ReactNode[];/*$*/ /*$*/var currentNode$asRequest: FZ.Request;/*$*/ /*$*/var currentNode$asDigest: FZ.ErrorDigest;/*$*/
  var node = task.node,
    childIndex = task.childIndex;
  if (null !== node) {
    if ("object" === typeof node) {
      switch (node.$$typeof) {
        case REACT_ELEMENT_TYPE:
          var type: FZ.ElementType = node.type,
            key: FZ.KeyOrIndex = node.key,
            props: FZ.Props = node.props;
          node = props.ref;
          var ref: FZ.Ref = void 0 !== node ? node : null,
            name: FZ.ComponentName = getComponentNameFromType(type),
            keyOrIndex: FZ.KeyOrIndex =
              null == key || key === REACT_OPTIMISTIC_KEY
                ? -1 === childIndex
                  ? 0
                  : childIndex
                : key;
          key$asKeyPath = [task.keyPath, name, keyOrIndex];
          if (null !== task.replay)
            a: {
              var replay: FZ.ReplaySet = task.replay;
              childIndex$asNodes = replay.nodes;
              for (node$asIndex = 0; node$asIndex < childIndex$asNodes.length; node$asIndex++) {
                var node$jscomp$0: FZ.ReplayNode = childIndex$asNodes[node$asIndex];
                if (keyOrIndex === node$jscomp$0[1]) {
                  if (4 === node$jscomp$0.length) {
                    if (null !== name && name !== node$jscomp$0[0])
                      throw Error(
                        "Expected the resume to render <" +
                          node$jscomp$0[0] +
                          "> in this slot but instead it rendered <" +
                          name +
                          ">. The tree doesn't match so React will fallback to client rendering."
                      );
                    var childNodes: FZ.ReplayNode[] = node$jscomp$0[2],
                      childSlots: FZ.ResumeSlots = node$jscomp$0[3],
                      currentNode: FZ.ReactNode = task.node;
                    task.replay = {
                      nodes: childNodes,
                      slots: childSlots,
                      pendingTasks: 1
                    };
                    try {
                      renderElement(request, task, key$asKeyPath, type, props, ref);
                      if (
                        1 === task.replay.pendingTasks &&
                        0 < task.replay.nodes.length
                      )
                        throw Error(
                          "Couldn't find all resumable slots by key/index during replaying. The tree doesn't match so React will fallback to client rendering."
                        );
                      task.replay.pendingTasks--;
                    } catch (x: FZ.Thrown) {
                      if (
                        "object" === typeof x &&
                        null !== x &&
                        (x === SuspenseException ||
                          "function" === typeof x.then ||
                          "Maximum call stack size exceeded" === x.message)
                      )
                        throw (
                          (task.node === currentNode
                            ? (task.replay = replay)
                            : childIndex$asNodes.splice(node$asIndex, 1),
                          x)
                        );
                      task.replay.pendingTasks--;
                      key$asInfo = getThrownInfo(task.componentStack);
                      currentNode$asRequest = request;
                      props$asBoundary = task.blockedBoundary;
                      request$asError = request.aborted ? request.fatalError : x;
                      key$asDigest = logRecoverableError(currentNode$asRequest, request$asError, key$asInfo);
                      abortRemainingReplayNodes(
                        currentNode$asRequest,
                        props$asBoundary,
                        childNodes,
                        childSlots,
                        request$asError,
                        key$asDigest
                      );
                    }
                    task.replay = replay;
                  } else {
                    if (type !== REACT_SUSPENSE_TYPE)
                      throw Error(
                        "Expected the resume to render <Suspense> in this slot but instead it rendered <" +
                          (getComponentNameFromType(type) || "Unknown") +
                          ">. The tree doesn't match so React will fallback to client rendering."
                      );
                    b: {
                      replay$asId = (node$jscomp$0[5]!) as FZ.SegmentId;
                      type$asNodes = node$jscomp$0[2];
                      ref$asSlots = node$jscomp$0[3];
                      name$asNodes =
                        null === node$jscomp$0[4] ? [] : node$jscomp$0[4]![2];
                      node$jscomp$0$asSlots =
                        null === node$jscomp$0[4] ? null : node$jscomp$0[4]![3];
                      keyOrIndex$asKeyPath = task.keyPath;
                      var prevContext = task.formatContext,
                        prevRow = task.row,
                        previousReplaySet = task.replay,
                        parentBoundary = task.blockedBoundary,
                        parentHoistableState = task.hoistableState,
                        content: FZ.ReactNode = props.children;
                      props = props.fallback;
                      var fallbackAbortSet = new Set<FZ.Task>(),
                        resumedBoundary = createSuspenseBoundary(
                          request,
                          task.row,
                          fallbackAbortSet,
                          2 > task.formatContext.insertionMode
                            ? {
                                content: createPreambleState(),
                                fallback: createPreambleState()
                              }/*$*/ as FZ.BoundaryPreamble/*$*/
                            : null,
                          !1
                        );
                      resumedBoundary.parentFlushed = !0;
                      resumedBoundary.rootSegmentID = replay$asId;
                      task.blockedBoundary = resumedBoundary;
                      task.hoistableState = resumedBoundary.contentState;
                      task.keyPath = key$asKeyPath;
                      task.formatContext = getSuspenseContentFormatContext(
                        request.resumableState,
                        prevContext
                      );
                      task.row = null;
                      task.replay = {
                        nodes: type$asNodes,
                        slots: ref$asSlots,
                        pendingTasks: 1
                      };
                      try {
                        renderNode(request, task, content, -1);
                        if (
                          1 === task.replay.pendingTasks &&
                          0 < task.replay.nodes.length
                        )
                          throw Error(
                            "Couldn't find all resumable slots by key/index during replaying. The tree doesn't match so React will fallback to client rendering."
                          );
                        task.replay.pendingTasks--;
                        if (
                          0 === resumedBoundary.pendingTasks &&
                          0 === resumedBoundary.status
                        ) {
                          resumedBoundary.status = 1;
                          request.completedBoundaries.push(resumedBoundary);
                          break b;
                        }
                      } catch (thrownValue: FZ.Thrown) {
                        (resumedBoundary.status = 4),
                          (childNodes$asThrown = request.aborted
                            ? request.fatalError
                            : thrownValue),
                          (childSlots$asInfo = getThrownInfo(task.componentStack)),
                          (currentNode$asDigest = logRecoverableError(
                            request,
                            childNodes$asThrown,
                            childSlots$asInfo
                          )),
                          (resumedBoundary.errorDigest = currentNode$asDigest),
                          task.replay.pendingTasks--,
                          request.clientRenderedBoundaries.push(
                            resumedBoundary
                          );
                      } finally {
                        (task.blockedBoundary = parentBoundary),
                          (task.hoistableState = parentHoistableState),
                          (task.replay = previousReplaySet),
                          (task.keyPath = keyOrIndex$asKeyPath),
                          (task.formatContext = prevContext),
                          (task.row = prevRow);
                      }
                      childNodes$asTask = createReplayTask(
                        request,
                        null,
                        { nodes: name$asNodes, slots: node$jscomp$0$asSlots, pendingTasks: 0 }/*$*/ as FZ.ReplaySet/*$*/,
                        props,
                        -1,
                        parentBoundary,
                        resumedBoundary.fallbackState,
                        fallbackAbortSet,
                        [key$asKeyPath[0], "Suspense Fallback", key$asKeyPath[2]],
                        getSuspenseFallbackFormatContext(
                          request.resumableState,
                          task.formatContext
                        ),
                        task.context,
                        task.treeContext,
                        task.row,
                        replaceSuspenseComponentStackWithSuspenseFallbackStack(
                          task.componentStack
                        )
                      );
                      pushComponentStack(childNodes$asTask);
                      request.pingedTasks.push(childNodes$asTask);
                    }
                  }
                  childIndex$asNodes.splice(node$asIndex, 1);
                  break a;
                }
              }
            }
          else renderElement(request, task, key$asKeyPath, type, props, ref);
          return;
        case REACT_PORTAL_TYPE:
          throw Error(
            "Portals are not currently supported by the server renderer. Render them conditionally so that they only appear on the client render."
          );
        case REACT_LAZY_TYPE:
          childNodes$asInit = node._init;
          node = childNodes$asInit(node._payload);
          if (request.aborted) throw null;
          renderNodeDestructive(request, task, node, childIndex);
          return;
      }
      if (isArrayImpl(node)) {
        renderChildrenArray(request, task, node, childIndex);
        return;
      }
      if ((childNodes$asIterator = getIteratorFn(node)))
        if ((childNodes$asIterator = childNodes$asIterator.call(node))) {
          node = childNodes$asIterator.next();
          if (!node.done) {
            childSlots$asChildren = [];
            do childSlots$asChildren.push(node.value), (node = childNodes$asIterator.next());
            while (!node.done);
            renderChildrenArray(request, task, childSlots$asChildren, childIndex);
          }
          return;
        }
      if ("function" === typeof node.then)
        return (
          (task.thenableState = null),
          renderNodeDestructive(request, task, unwrapThenable(node), childIndex)
        );
      if (node.$$typeof === REACT_CONTEXT_TYPE)
        return renderNodeDestructive(
          request,
          task,
          node._currentValue,
          childIndex
        );
      childIndex$asString = Object.prototype.toString.call(node);
      throw Error(
        "Objects are not valid as a React child (found: " +
          ("[object Object]" === childIndex$asString
            ? "object with keys {" + Object.keys(node).join(", ") + "}"
            : childIndex$asString) +
          "). If you meant to render a collection of children, use an array instead."
      );
    }
    if ("string" === typeof node)
      (childIndex$asSegment = task.blockedSegment),
        null !== childIndex$asSegment &&
          (childIndex$asSegment.lastPushedText = pushTextInstance(
            childIndex$asSegment.chunks,
            node,
            request.renderState,
            childIndex$asSegment.lastPushedText
          ));
    else if ("number" === typeof node || "bigint" === typeof node)
      (childIndex$asSegment = task.blockedSegment),
        null !== childIndex$asSegment &&
          (childIndex$asSegment.lastPushedText = pushTextInstance(
            childIndex$asSegment.chunks,
            "" + node,
            request.renderState,
            childIndex$asSegment.lastPushedText
          ));
  }
}
function renderChildrenArray(request$given: FZ.Request, task: FZ.Task, children$given: FZ.ReactNode[], childIndex$given: FZ.ChildIndex): void { /*$*/var request: FZ.Request, children: FZ.ReactNode[], childIndex; request = request$given; var request$asError: FZ.Thrown; var children$asRequest: FZ.Request; children = children$given; childIndex = childIndex$given;/*$*/ /*$*/var replay$asTreeContext: FZ.TreeContext;/*$*/ /*$*/var replayNodes$asLength: FZ.int32;/*$*/ /*$*/var j$asSlots: FZ.ResumeSlots;/*$*/ /*$*/var node$asSlots: FZ.ResumeSlots;/*$*/ /*$*/var node$asChild: FZ.ReactNode;/*$*/ /*$*/var thrownInfo$asDigest: FZ.ErrorDigest;/*$*/ /*$*/var boundary$asId: FZ.SegmentId | undefined;/*$*/
  var prevKeyPath = task.keyPath;
  if (
    -1 !== childIndex &&
    ((task.keyPath = [task.keyPath, "Fragment", childIndex]),
    null !== task.replay)
  ) {
    for (
      var replay: FZ.ReplaySet = task.replay, replayNodes: FZ.ReplayNode[] = replay.nodes, j: number = 0;
      j < replayNodes.length;
      j++
    ) {
      var node: FZ.ReplayNode = replayNodes[j];
      if (node[1] === childIndex) {
        childIndex = node[2];
        node$asSlots = node[3];
        task.replay = { nodes: childIndex, slots: node$asSlots, pendingTasks: 1 };
        try {
          renderChildrenArray(request, task, children, -1);
          if (1 === task.replay.pendingTasks && 0 < task.replay.nodes.length)
            throw Error(
              "Couldn't find all resumable slots by key/index during replaying. The tree doesn't match so React will fallback to client rendering."
            );
          task.replay.pendingTasks--;
        } catch (x: FZ.Thrown) {
          if (
            "object" === typeof x &&
            null !== x &&
            (x === SuspenseException || "function" === typeof x.then)
          )
            throw x;
          task.replay.pendingTasks--;
          var thrownInfo = getThrownInfo(task.componentStack);
          children$asRequest = request;
          var boundary = task.blockedBoundary;
          request$asError = request.aborted ? request.fatalError : x;
          thrownInfo$asDigest = logRecoverableError(children$asRequest, request$asError, thrownInfo);
          abortRemainingReplayNodes(
            children$asRequest,
            boundary,
            childIndex,
            node$asSlots,
            request$asError,
            thrownInfo$asDigest
          );
        }
        task.replay = replay;
        replayNodes.splice(j, 1);
        break;
      }
    }
    task.keyPath = prevKeyPath;
    return;
  }
  replay$asTreeContext = task.treeContext;
  replayNodes$asLength = children.length as FZ.int32;
  if (
    null !== task.replay &&
    ((j$asSlots = task.replay.slots), null !== j$asSlots && "object" === typeof j$asSlots)
  ) {
    for (childIndex = 0; childIndex < replayNodes$asLength; childIndex++)
      (node$asChild = children[childIndex]),
        (task.treeContext = pushTreeContext(replay$asTreeContext, replayNodes$asLength, childIndex)),
        (boundary$asId = /*$*/(/*$*/j$asSlots/*$*/ as FZ.SlotMap)/*$*/[childIndex]),
        "number" === typeof boundary$asId
          ? (resumeNode(request, task, boundary$asId as FZ.SegmentId, node$asChild, childIndex as FZ.ChildIndex),
            delete /*$*/(/*$*/j$asSlots/*$*/ as FZ.SlotMap)/*$*/[childIndex])
          : renderNode(request, task, node$asChild, childIndex as FZ.ChildIndex);
    task.treeContext = replay$asTreeContext;
    task.keyPath = prevKeyPath;
    return;
  }
  for (j = 0; j < replayNodes$asLength; j++)
    (childIndex = children[j]),
      (task.treeContext = pushTreeContext(replay$asTreeContext, replayNodes$asLength, j)),
      renderNode(request, task, childIndex, j as FZ.ChildIndex);
  task.treeContext = replay$asTreeContext;
  task.keyPath = prevKeyPath;
}
function trackPostponedBoundary(request$given: FZ.Request, trackedPostpones: FZ.PostponedHoles, boundary$given: FZ.SuspenseBoundary): FZ.ReplayNode { /*$*/var request, boundary; request = request$given; boundary = boundary$given;/*$*/ /*$*/var tracked$asNode: FZ.ReplayNode | null;/*$*/
  boundary.status = 5;
  boundary.rootSegmentID = request.nextSegmentId++;
  var tracked = boundary.tracked;
  if (null === tracked)
    throw Error(
      "It should not be possible to postpone at the root. This is a bug in React."
    );
  request = tracked.contentKeyPath;
  if (null === request)
    throw Error(
      "It should not be possible to postpone at the root. This is a bug in React."
    );
  tracked$asNode = tracked.fallbackNode;
  var children: FZ.ReplayNode[] = [],
    boundaryNode = trackedPostpones.workingMap.get(request);
  if (void 0 === boundaryNode)
    return (
      (boundary = [
        request[1],
        request[2],
        children,
        null,
        tracked$asNode,
        boundary.rootSegmentID
      ]/*$*/ as FZ.ReplayNode/*$*/),
      trackedPostpones.workingMap.set(request, boundary),
      addToReplayParent(boundary, request[0], trackedPostpones),
      boundary
    );
  boundaryNode[4] = tracked$asNode;
  boundaryNode[5] = boundary.rootSegmentID;
  return boundaryNode;
}
function trackPostpone(request$given: FZ.Request, trackedPostpones: FZ.PostponedHoles, task$given: FZ.Task, segment: FZ.Segment): void { /*$*/var request, task; request = request$given; task = task$given;/*$*/ /*$*/var boundary$asMap: Map<FZ.KeyNode, FZ.ReplayNode>;/*$*/
  segment.status = 5;
  var keyPath = task.keyPath,
    boundary = task.blockedBoundary;
  if (null === boundary)
    (segment.id = request.nextSegmentId++),
      (trackedPostpones.rootSlots = segment.id),
      null !== request.completedRootSegment &&
        (request.completedRootSegment.status = 5);
  else {
    if (null !== boundary && 0 === boundary.status) {
      var boundaryNode: FZ.ReplayNode | undefined = trackPostponedBoundary(
        request,
        trackedPostpones,
        boundary
      );
      if (
        null !== boundary.tracked &&
        boundary.tracked.contentKeyPath === keyPath &&
        -1 === task.childIndex
      ) {
        -1 === segment.id &&
          (segment.id = segment.parentFlushed
            ? boundary.rootSegmentID
            : request.nextSegmentId++);
        boundaryNode[3] = segment.id;
        return;
      }
    }
    -1 === segment.id &&
      (segment.id =
        segment.parentFlushed && null !== boundary
          ? boundary.rootSegmentID
          : request.nextSegmentId++);
    if (-1 === task.childIndex)
      null === keyPath
        ? (trackedPostpones.rootSlots = segment.id)
        : ((task = trackedPostpones.workingMap.get(keyPath)),
          void 0 === task
            ? ((task = [keyPath[1], keyPath[2], [], segment.id]/*$*/ as FZ.ReplayNode/*$*/),
              addToReplayParent(task, keyPath[0], trackedPostpones))
            : (task[3] = segment.id));
    else {
      if (null === keyPath)
        if (((request = trackedPostpones.rootSlots), null === request))
          request = trackedPostpones.rootSlots = {}/*$*/ as FZ.SlotMap/*$*/;
        else {
          if ("number" === typeof request)
            throw Error(
              "It should not be possible to postpone both at the root of an element as well as a slot below. This is a bug in React."
            );
        }
      else if (
        ((boundary$asMap = trackedPostpones.workingMap),
        (boundaryNode = boundary$asMap.get(keyPath)),
        void 0 === boundaryNode)
      )
        (request = {}/*$*/ as FZ.SlotMap/*$*/),
          (boundaryNode = [keyPath[1], keyPath[2], [], request]),
          boundary$asMap.set(keyPath, boundaryNode),
          addToReplayParent(boundaryNode, keyPath[0], trackedPostpones);
      else if (((request = boundaryNode[3]), null === request))
        request = boundaryNode[3] = {}/*$*/ as FZ.SlotMap/*$*/;
      else if ("number" === typeof request)
        throw Error(
          "It should not be possible to postpone both at the root of an element as well as a slot below. This is a bug in React."
        );
      request[task.childIndex] = segment.id;
    }
  }
}
function untrackBoundary(request$given: FZ.Request, boundary$given: FZ.SuspenseBoundary): void { /*$*/var request, boundary; request = request$given; boundary = boundary$given;/*$*/
  request = request.trackedPostpones;
  null !== request &&
    ((boundary = boundary.tracked),
    null !== boundary &&
      ((boundary = boundary.contentKeyPath),
      null !== boundary &&
        ((request = request.workingMap.get(boundary)),
        void 0 !== request &&
          ((request.length = 4), (request[2] = []), (request[3] = null)))));
}
function spawnNewSuspendedReplayTask(request: FZ.Request, task: FZ.Task, thenableState: FZ.ThenableState | null): FZ.Task {
  return createReplayTask(
    request,
    thenableState,
    task.replay!,
    task.node,
    task.childIndex,
    task.blockedBoundary,
    task.hoistableState,
    task.abortSet,
    task.keyPath,
    task.formatContext,
    task.context,
    task.treeContext,
    task.row,
    task.componentStack
  );
}
function spawnNewSuspendedRenderTask(request: FZ.Request, task: FZ.Task, thenableState: FZ.ThenableState | null): FZ.Task {
  var segment = task.blockedSegment!,
    newSegment = createPendingSegment(
      request,
      segment.chunks.length as FZ.ChunkIndex,
      null,
      task.formatContext,
      segment.lastPushedText,
      !0
    );
  segment.children.push(newSegment);
  segment.lastPushedText = !1;
  return createRenderTask(
    request,
    thenableState,
    task.node,
    task.childIndex,
    task.blockedBoundary,
    newSegment,
    task.blockedPreamble,
    task.hoistableState,
    task.abortSet,
    task.keyPath,
    task.formatContext,
    task.context,
    task.treeContext,
    task.row,
    task.componentStack
  );
}
function renderNode(request$given: FZ.Request, task: FZ.Task, node$given: FZ.ReactNode, childIndex$given: FZ.ChildIndex): void { /*$*/var request, node, childIndex; request = request$given; node = node$given; childIndex = childIndex$given; var segment$asReplay: FZ.ReplaySet | null, segment$asThenable: FZ.Thenable, segment$asThenableState: FZ.ThenableState | null, segment$asTask: FZ.Task;/*$*/
  var previousFormatContext = task.formatContext,
    previousContext = task.context,
    previousKeyPath = task.keyPath,
    previousTreeContext = task.treeContext,
    previousComponentStack = task.componentStack,
    segment = task.blockedSegment;
  if (null === segment) {
    segment$asReplay = task.replay;
    try {
      return renderNodeDestructive(request, task, node, childIndex as FZ.ChildIndex);
    } catch (thrownValue: FZ.Thrown) {
      if (
        (resetHooksState(),
        (node =
          thrownValue === SuspenseException
            ? getSuspendedThenable()
            : thrownValue),
        !request.aborted && "object" === typeof node && null !== node)
      ) {
        if ("function" === typeof node.then) {
          childIndex =
            thrownValue === SuspenseException
              ? getThenableStateAfterSuspending()
              : null;
          request = spawnNewSuspendedReplayTask(request, task, childIndex).ping;
          node.then(request.resolve, request.reject);
          task.formatContext = previousFormatContext;
          task.context = previousContext;
          task.keyPath = previousKeyPath;
          task.treeContext = previousTreeContext;
          task.componentStack = previousComponentStack;
          task.replay = segment$asReplay;
          switchContext(previousContext);
          return;
        }
        if ("Maximum call stack size exceeded" === node.message) {
          node =
            thrownValue === SuspenseException
              ? getThenableStateAfterSuspending()
              : null;
          node = spawnNewSuspendedReplayTask(request, task, node);
          request.pingedTasks.push(node);
          task.formatContext = previousFormatContext;
          task.context = previousContext;
          task.keyPath = previousKeyPath;
          task.treeContext = previousTreeContext;
          task.componentStack = previousComponentStack;
          task.replay = segment$asReplay;
          switchContext(previousContext);
          return;
        }
      }
    }
  } else {
    var childrenLength = segment.children.length,
      chunkLength = segment.chunks.length;
    try {
      return renderNodeDestructive(request, task, node, childIndex as FZ.ChildIndex);
    } catch (thrownValue$64: FZ.Thrown) {
      if (
        (resetHooksState(),
        (segment.children.length = childrenLength),
        (segment.chunks.length = chunkLength),
        (node =
          thrownValue$64 === SuspenseException
            ? getSuspendedThenable()
            : thrownValue$64),
        !request.aborted && "object" === typeof node && null !== node)
      ) {
        if ("function" === typeof node.then) {
          segment$asThenable = node;
          node =
            thrownValue$64 === SuspenseException
              ? getThenableStateAfterSuspending()
              : null;
          request = spawnNewSuspendedRenderTask(request, task, node).ping;
          segment$asThenable.then(request.resolve, request.reject);
          task.formatContext = previousFormatContext;
          task.context = previousContext;
          task.keyPath = previousKeyPath;
          task.treeContext = previousTreeContext;
          task.componentStack = previousComponentStack;
          switchContext(previousContext);
          return;
        }
        if ("Maximum call stack size exceeded" === node.message) {
          segment$asThenableState =
            thrownValue$64 === SuspenseException
              ? getThenableStateAfterSuspending()
              : null;
          segment$asTask = spawnNewSuspendedRenderTask(request, task, segment$asThenableState);
          request.pingedTasks.push(segment$asTask);
          task.formatContext = previousFormatContext;
          task.context = previousContext;
          task.keyPath = previousKeyPath;
          task.treeContext = previousTreeContext;
          task.componentStack = previousComponentStack;
          switchContext(previousContext);
          return;
        }
      }
    }
  }
  task.formatContext = previousFormatContext;
  task.context = previousContext;
  task.keyPath = previousKeyPath;
  task.treeContext = previousTreeContext;
  switchContext(previousContext);
  throw node;
}
function abortTaskSoft(this: FZ.Request, task: FZ.Task): void {
  var boundary = task.blockedBoundary,
    segment = task.blockedSegment;
  null !== segment &&
    ((segment.status = 3), finishedTask(this, boundary, task.row, segment));
}
function abortRemainingReplayNodes(
  request$jscomp$0: FZ.Request,
  boundary: FZ.SuspenseBoundary | null,
  nodes: FZ.ReplayNode[],
  slots: FZ.ResumeSlots,
  error: FZ.Thrown,
  errorDigest$jscomp$0: FZ.ErrorDigest
): void {
  for (var i = 0; i < nodes.length; i++) {
    var node: FZ.ReplayNode | FZ.SegmentId = nodes[i];
    if (4 === node.length)
      abortRemainingReplayNodes(
        request$jscomp$0,
        boundary,
        node[2],
        node[3],
        error,
        errorDigest$jscomp$0
      );
    else {
      node = node[5]!;
      var request = request$jscomp$0,
        errorDigest = errorDigest$jscomp$0,
        resumedBoundary = createSuspenseBoundary(
          request,
          null,
          new Set(),
          null,
          !1
        );
      resumedBoundary.parentFlushed = !0;
      resumedBoundary.rootSegmentID = node;
      resumedBoundary.status = 4;
      resumedBoundary.errorDigest = errorDigest;
      resumedBoundary.parentFlushed &&
        request.clientRenderedBoundaries.push(resumedBoundary);
    }
  }
  nodes.length = 0;
  if (null !== slots) {
    if (null === boundary)
      throw Error(
        "We should not have any resumable nodes in the shell. This is a bug in React."
      );
    4 !== boundary.status &&
      ((boundary.status = 4),
      (boundary.errorDigest = errorDigest$jscomp$0),
      boundary.parentFlushed &&
        request$jscomp$0.clientRenderedBoundaries.push(boundary));
    if ("object" === typeof slots) for (var index in slots) delete slots[index];
  }
}
function abortTask(task$given: FZ.Task, request: FZ.Request): void { /*$*/var task; task = task$given;/*$*/
  if (task !== request.currentTask) {
    var boundary = task.blockedBoundary;
    task = task.blockedSegment;
    null !== task && (task.status = 3);
    null !== boundary &&
      boundary.fallbackAbortableTasks.forEach(function (fallbackTask) {
        return abortTask(fallbackTask, request);
      });
  }
}
function finishAbortedTask(task$given: FZ.Task, request: FZ.Request, error: FZ.Thrown): void { /*$*/var task; task = task$given; var boundary$asReplay: FZ.ReplaySet | null, boundary$asPostpones: FZ.PostponedHoles, errorInfo$asDigest: FZ.ErrorDigest, errorInfo$asRow: FZ.SuspenseListRow | null;/*$*/
  if (task !== request.currentTask) {
    var boundary = task.blockedBoundary,
      segment = task.blockedSegment;
    if (null === segment || 3 === segment.status) {
      var errorInfo = getThrownInfo(task.componentStack),
        isRecoverableReason = isRecoverableError(error);
      if (null === boundary) {
        boundary$asReplay = task.replay;
        if (null === boundary$asReplay) {
          isRecoverableReason ||
          null === request.trackedPostpones ||
          null === segment
            ? isRecoverableReason
              ? ((task = cloneRecoverableErrorAsFatal(error)),
                logRecoverableError(request, task, errorInfo),
                12 !== request.status &&
                  13 !== request.status &&
                  fatalError(request, task))
              : (logRecoverableError(request, error, errorInfo),
                12 !== request.status &&
                  13 !== request.status &&
                  fatalError(request, error))
            : ((boundary$asPostpones = request.trackedPostpones),
              logRecoverableError(request, error, errorInfo),
              trackPostpone(request, boundary$asPostpones, task, segment),
              finishedTask(request, null, task.row, segment));
          return;
        }
        12 !== request.status &&
          13 !== request.status &&
          (boundary$asReplay.pendingTasks--,
          0 === boundary$asReplay.pendingTasks &&
            0 < boundary$asReplay.nodes.length &&
            ((errorInfo$asDigest = logRecoverableError(request, error, errorInfo)),
            abortRemainingReplayNodes(
              request,
              null,
              boundary$asReplay.nodes,
              boundary$asReplay.slots,
              error,
              errorInfo$asDigest
            )),
          request.pendingRootTasks--,
          0 === request.pendingRootTasks && completeShell(request));
      } else {
        var trackedPostpones$65 = request.trackedPostpones;
        if (4 !== boundary.status) {
          if (
            !isRecoverableReason &&
            null !== trackedPostpones$65 &&
            null !== segment
          )
            return (
              logRecoverableError(request, error, errorInfo),
              trackPostpone(request, trackedPostpones$65, task, segment),
              boundary.fallbackAbortableTasks.forEach(function (fallbackTask) {
                return finishAbortedTask(fallbackTask, request, error);
              }),
              boundary.fallbackAbortableTasks.clear(),
              finishedTask(request, boundary, task.row, segment)
            );
          boundary.status = 4;
          errorInfo$asDigest = logRecoverableError(request, error, errorInfo);
          boundary.errorDigest = errorInfo$asDigest;
          untrackBoundary(request, boundary);
          boundary.parentFlushed &&
            request.clientRenderedBoundaries.push(boundary);
        }
        boundary.pendingTasks--;
        errorInfo$asRow = boundary.row;
        null !== errorInfo$asRow &&
          0 === --errorInfo$asRow.pendingTasks &&
          finishSuspenseListRow(request, errorInfo$asRow);
        boundary.fallbackAbortableTasks.forEach(function (fallbackTask) {
          return finishAbortedTask(fallbackTask, request, error);
        });
        boundary.fallbackAbortableTasks.clear();
      }
      task = task.row;
      null !== task &&
        0 === --task.pendingTasks &&
        finishSuspenseListRow(request, task);
      request.allPendingTasks--;
      0 === request.allPendingTasks && completeAll(request);
    }
  }
}
function safelyEmitEarlyPreloads(request: FZ.Request, shellComplete: boolean): void {
  try {
    var renderState = request.renderState,
      onHeaders = renderState.onHeaders;
    if (onHeaders) {
      var headers = renderState.headers;
      if (headers) {
        renderState.headers = null;
        var linkHeader = headers.preconnects;
        headers.fontPreloads &&
          (linkHeader && (linkHeader += ", "),
          (linkHeader += headers.fontPreloads));
        headers.highImagePreloads &&
          (linkHeader && (linkHeader += ", "),
          (linkHeader += headers.highImagePreloads));
        if (!shellComplete) {
          var queueIter = renderState.styles.values(),
            queueStep = queueIter.next();
          b: for (
            ;
            0 < headers.remainingCapacity && !queueStep.done;
            queueStep = queueIter.next()
          )
            for (
              var sheetIter = queueStep.value.sheets.values(),
                sheetStep = sheetIter.next();
              0 < headers.remainingCapacity && !sheetStep.done;
              sheetStep = sheetIter.next()
            ) {
              var sheet = sheetStep.value,
                props = sheet.props,
                key = props.href,
                props$jscomp$0 = sheet.props,
                header = getPreloadAsHeader(props$jscomp$0.href, "style", {
                  crossOrigin: props$jscomp$0.crossOrigin,
                  integrity: props$jscomp$0.integrity,
                  nonce: props$jscomp$0.nonce,
                  type: props$jscomp$0.type,
                  fetchPriority: props$jscomp$0.fetchPriority,
                  referrerPolicy: props$jscomp$0.referrerPolicy,
                  media: props$jscomp$0.media
                });
              if (0 <= (headers.remainingCapacity -= header.length + 2))
                (renderState.resets.style[key] = PRELOAD_NO_CREDS),
                  linkHeader && (linkHeader += ", "),
                  (linkHeader += header),
                  (renderState.resets.style[key] =
                    "string" === typeof props.crossOrigin ||
                    "string" === typeof props.integrity
                      ? [props.crossOrigin, props.integrity]
                      : PRELOAD_NO_CREDS);
              else break b;
            }
        }
        linkHeader ? onHeaders({ Link: linkHeader }) : onHeaders({});
      }
    }
  } catch (error: FZ.Thrown) {
    logRecoverableError(request, error, {});
  }
}
function completeShell(request$given: FZ.Request): void { /*$*/var request; request = request$given;/*$*/
  null === request.trackedPostpones && safelyEmitEarlyPreloads(request, !0);
  null === request.trackedPostpones && preparePreamble(request);
  request = request.onShellReady;
  request();
}
function completeAll(request$given: FZ.Request): void { /*$*/var request; request = request$given;/*$*/
  safelyEmitEarlyPreloads(
    request,
    null === request.trackedPostpones
      ? !0
      : null === request.completedRootSegment ||
          5 !== request.completedRootSegment.status
  );
  preparePreamble(request);
  request = request.onAllReady;
  request();
}
function queueCompletedSegment(boundary: FZ.SuspenseBoundary, segment: FZ.Segment): void {
  if (
    0 === segment.chunks.length &&
    1 === segment.children.length &&
    null === segment.children[0].boundary &&
    -1 === segment.children[0].id
  ) {
    var childSegment = segment.children[0];
    childSegment.id = segment.id;
    childSegment.parentFlushed = !0;
    (1 !== childSegment.status &&
      3 !== childSegment.status &&
      4 !== childSegment.status) ||
      queueCompletedSegment(boundary, childSegment);
  } else boundary.completedSegments.push(segment);
}
function finishedSegment(request: FZ.Request, boundary: FZ.SuspenseBoundary | null, segment$given: FZ.Segment): void { /*$*/var segment; segment = segment$given;/*$*/
  if (null !== byteLengthOfChunk) {
    segment = segment.chunks;
    for (var segmentByteSize: FZ.ByteSize = 0, i = 0; i < segment.length; i++)
      segmentByteSize += byteLengthOfChunk(segment[i]);
    null === boundary
      ? (request.byteSize += segmentByteSize)
      : (boundary.byteSize += segmentByteSize);
  }
}
function finishedTask(request: FZ.Request, boundary: FZ.SuspenseBoundary | null, row: FZ.SuspenseListRow | null, segment: FZ.Segment | null): void { /*$*/var boundary$asRow: FZ.SuspenseListRow | null, row$asPostpones: FZ.PostponedHoles, segment$asBoundaries: FZ.SuspenseBoundary[] | null, postponedRow$asIndex: number;/*$*/
  null !== row &&
    (0 === --row.pendingTasks
      ? finishSuspenseListRow(request, row)
      : row.together && tryToResolveTogetherRow(request, row));
  request.allPendingTasks--;
  if (null === boundary) {
    if (null !== segment && segment.parentFlushed) {
      if (null !== request.completedRootSegment)
        throw Error(
          "There can only be one root segment. This is a bug in React."
        );
      request.completedRootSegment = segment;
    }
    request.pendingRootTasks--;
    0 === request.pendingRootTasks && completeShell(request);
  } else if ((boundary.pendingTasks--, 4 !== boundary.status))
    if (0 === boundary.pendingTasks)
      if (
        (0 === boundary.status && (boundary.status = 1),
        null !== segment &&
          segment.parentFlushed &&
          (1 === segment.status || 3 === segment.status) &&
          queueCompletedSegment(boundary, segment),
        boundary.parentFlushed && request.completedBoundaries.push(boundary),
        1 === boundary.status)
      )
        (row = boundary.row),
          null !== row &&
            hoistHoistables(row.hoistables, boundary.contentState),
          isEligibleForOutlining(request, boundary) ||
            (request.allPendingTasks++,
            boundary.fallbackAbortableTasks.forEach(abortTaskSoft, request),
            boundary.fallbackAbortableTasks.clear(),
            null !== row &&
              0 === --row.pendingTasks &&
              finishSuspenseListRow(request, row),
            request.allPendingTasks--),
          0 === request.pendingRootTasks &&
            null === request.trackedPostpones &&
            null !== boundary.preamble &&
            preparePreamble(request);
      else {
        if (
          5 === boundary.status &&
          ((boundary$asRow = boundary.row), null !== boundary$asRow)
        ) {
          if (null !== request.trackedPostpones) {
            row$asPostpones = request.trackedPostpones;
            var postponedRow: FZ.SuspenseListRow | null = boundary$asRow.next;
            if (
              null !== postponedRow &&
              ((segment$asBoundaries = postponedRow.boundaries), null !== segment$asBoundaries)
            )
              for (
                postponedRow.boundaries = null, postponedRow$asIndex = 0;
                postponedRow$asIndex < segment$asBoundaries.length;
                postponedRow$asIndex++
              ) {
                var postponedBoundary = segment$asBoundaries[postponedRow$asIndex];
                trackPostponedBoundary(request, row$asPostpones, postponedBoundary);
                finishedTask(request, postponedBoundary, null, null);
              }
          }
          request.allPendingTasks++;
          0 === --boundary$asRow.pendingTasks &&
            finishSuspenseListRow(request, boundary$asRow);
          request.allPendingTasks--;
        }
      }
    else
      null === segment ||
        !segment.parentFlushed ||
        (1 !== segment.status && 3 !== segment.status) ||
        (queueCompletedSegment(boundary, segment),
        1 === boundary.completedSegments.length &&
          boundary.parentFlushed &&
          request.partialBoundaries.push(boundary)),
        (boundary$asRow = boundary.row),
        null !== boundary$asRow &&
          boundary$asRow.together &&
          tryToResolveTogetherRow(request, boundary$asRow);
  0 === request.allPendingTasks && completeAll(request);
}
function performWork(request$jscomp$1: FZ.Request): void { /*$*/var request$jscomp$0$asSegment: FZ.Segment;/*$*/
  if (!(request$jscomp$1.aborted || 11 < request$jscomp$1.status)) {
    var prevContext = currentActiveSnapshot,
      prevDispatcher = ReactSharedInternals.H;
    ReactSharedInternals.H = HooksDispatcher;
    var prevAsyncDispatcher = ReactSharedInternals.A;
    ReactSharedInternals.A = DefaultAsyncDispatcher;
    var prevRequest = currentRequest;
    currentRequest = request$jscomp$1;
    var prevResumableState = currentResumableState;
    currentResumableState = request$jscomp$1.resumableState;
    try {
      var pingedTasks = request$jscomp$1.pingedTasks,
        i: number;
      for (i = 0; i < pingedTasks.length; i++) {
        var task = pingedTasks[i],
          request = request$jscomp$1,
          segment = task.blockedSegment;
        if (null === segment)
          a: {
            if (0 !== task.replay!.pendingTasks) {
              var prevTask = request.currentTask;
              request.currentTask = task;
              switchContext(task.context);
              var startNode = task.node;
              try {
                "number" === typeof task.replay!.slots
                  ? resumeNode(
                      request,
                      task,
                      (task.replay!.slots) as FZ.SegmentId,
                      task.node,
                      task.childIndex
                    )
                  : retryNode(request, task);
                if (
                  1 === task.replay!.pendingTasks &&
                  0 < task.replay!.nodes.length
                )
                  throw Error(
                    "Couldn't find all resumable slots by key/index during replaying. The tree doesn't match so React will fallback to client rendering."
                  );
                task.replay!.pendingTasks--;
                task.abortSet.delete(task);
                finishedTask(request, task.blockedBoundary, task.row, null);
              } catch (thrownValue: FZ.Thrown) {
                resetHooksState();
                var x =
                  thrownValue === SuspenseException
                    ? getSuspendedThenable()
                    : thrownValue;
                if (request.aborted) {
                  thrownValue === SuspenseException &&
                    (task.thenableState = getThenableStateAfterSuspending());
                  request.currentTask = prevTask;
                  var request$jscomp$0 = request;
                  abortTask(task, request$jscomp$0);
                  task.abortSet.delete(task);
                  finishAbortedTask(
                    task,
                    request$jscomp$0,
                    request$jscomp$0.fatalError
                  );
                } else {
                  if ("object" === typeof x && null !== x) {
                    if ("function" === typeof x.then) {
                      var ping = task.ping;
                      x.then(ping.resolve, ping.reject);
                      task.thenableState =
                        thrownValue === SuspenseException
                          ? getThenableStateAfterSuspending()
                          : null;
                      break a;
                    }
                    if (
                      "Maximum call stack size exceeded" === x.message &&
                      task.node !== startNode
                    ) {
                      task.thenableState = null;
                      request.pingedTasks.push(task);
                      break a;
                    }
                  }
                  task.replay!.pendingTasks--;
                  task.abortSet.delete(task);
                  var errorInfo = getThrownInfo(task.componentStack);
                  request$jscomp$0 = request;
                  var boundary = task.blockedBoundary,
                    error$jscomp$0 = request.aborted ? request.fatalError : x,
                    replayNodes = task.replay!.nodes,
                    resumeSlots = task.replay!.slots,
                    errorDigest = logRecoverableError(
                      request$jscomp$0,
                      error$jscomp$0,
                      errorInfo
                    );
                  abortRemainingReplayNodes(
                    request$jscomp$0,
                    boundary,
                    replayNodes,
                    resumeSlots,
                    error$jscomp$0,
                    errorDigest
                  );
                  request.pendingRootTasks--;
                  0 === request.pendingRootTasks && completeShell(request);
                  request.allPendingTasks--;
                  0 === request.allPendingTasks && completeAll(request);
                }
              } finally {
                request.currentTask = prevTask;
              }
            }
          }
        else
          a: if (
            ((request$jscomp$0$asSegment = segment), 0 === request$jscomp$0$asSegment.status)
          ) {
            var prevTask$jscomp$0 = request.currentTask;
            request.currentTask = task;
            switchContext(task.context);
            var childrenLength: FZ.ChunkIndex = request$jscomp$0$asSegment.children.length as FZ.ChunkIndex,
              chunkLength: FZ.ChunkIndex = request$jscomp$0$asSegment.chunks.length as FZ.ChunkIndex,
              startNode$jscomp$0 = task.node;
            try {
              retryNode(request, task),
                pushSegmentFinale(
                  request$jscomp$0$asSegment.chunks,
                  request.renderState,
                  request$jscomp$0$asSegment.lastPushedText,
                  request$jscomp$0$asSegment.textEmbedded
                ),
                task.abortSet.delete(task),
                (request$jscomp$0$asSegment.status = 1),
                finishedSegment(
                  request,
                  task.blockedBoundary,
                  request$jscomp$0$asSegment
                ),
                finishedTask(
                  request,
                  task.blockedBoundary,
                  task.row,
                  request$jscomp$0$asSegment
                );
            } catch (thrownValue: FZ.Thrown) {
              resetHooksState();
              request$jscomp$0$asSegment.children.length = childrenLength;
              request$jscomp$0$asSegment.chunks.length = chunkLength;
              var x$jscomp$0 =
                thrownValue === SuspenseException
                  ? getSuspendedThenable()
                  : thrownValue;
              if (request.aborted)
                thrownValue === SuspenseException &&
                  (task.thenableState = getThenableStateAfterSuspending()),
                  (request.currentTask = prevTask$jscomp$0),
                  (request$jscomp$0 = request),
                  abortTask(task, request$jscomp$0),
                  task.abortSet.delete(task),
                  finishAbortedTask(
                    task,
                    request$jscomp$0,
                    request$jscomp$0.fatalError
                  );
              else {
                if ("object" === typeof x$jscomp$0 && null !== x$jscomp$0) {
                  if ("function" === typeof x$jscomp$0.then) {
                    request$jscomp$0$asSegment.status = 0;
                    task.thenableState =
                      thrownValue === SuspenseException
                        ? getThenableStateAfterSuspending()
                        : null;
                    var ping$jscomp$0 = task.ping;
                    x$jscomp$0.then(
                      ping$jscomp$0.resolve,
                      ping$jscomp$0.reject
                    );
                    break a;
                  }
                  if (
                    "Maximum call stack size exceeded" === x$jscomp$0.message &&
                    task.node !== startNode$jscomp$0
                  ) {
                    request$jscomp$0$asSegment.status = 0;
                    task.thenableState = null;
                    request.pingedTasks.push(task);
                    break a;
                  }
                }
                var errorInfo$jscomp$0 = getThrownInfo(task.componentStack);
                task.abortSet.delete(task);
                request$jscomp$0$asSegment.status = 4;
                var boundary$jscomp$0 = task.blockedBoundary,
                  row = task.row;
                null !== row &&
                  0 === --row.pendingTasks &&
                  finishSuspenseListRow(request, row);
                request.allPendingTasks--;
                if (null === boundary$jscomp$0)
                  if (isRecoverableError(x$jscomp$0)) {
                    var fatalRecoverableError =
                      cloneRecoverableErrorAsFatal(x$jscomp$0);
                    logRecoverableError(
                      request,
                      fatalRecoverableError,
                      errorInfo$jscomp$0
                    );
                    fatalError(request, fatalRecoverableError);
                  } else
                    logRecoverableError(
                      request,
                      x$jscomp$0,
                      errorInfo$jscomp$0
                    ),
                      fatalError(request, x$jscomp$0);
                else {
                  var errorDigest$jscomp$0 = logRecoverableError(
                    request,
                    x$jscomp$0,
                    errorInfo$jscomp$0
                  );
                  boundary$jscomp$0.pendingTasks--;
                  if (4 !== boundary$jscomp$0.status) {
                    boundary$jscomp$0.status = 4;
                    boundary$jscomp$0.errorDigest = errorDigest$jscomp$0;
                    untrackBoundary(request, boundary$jscomp$0);
                    var boundaryRow = boundary$jscomp$0.row;
                    null !== boundaryRow &&
                      (request.allPendingTasks++,
                      0 === --boundaryRow.pendingTasks &&
                        finishSuspenseListRow(request, boundaryRow),
                      request.allPendingTasks--);
                    boundary$jscomp$0.parentFlushed &&
                      request.clientRenderedBoundaries.push(boundary$jscomp$0);
                    0 === request.pendingRootTasks &&
                      null === request.trackedPostpones &&
                      null !== boundary$jscomp$0.preamble &&
                      preparePreamble(request);
                  }
                  0 === request.allPendingTasks && completeAll(request);
                }
              }
            } finally {
              request.currentTask = prevTask$jscomp$0;
            }
          }
      }
      pingedTasks.splice(0, i);
      null !== request$jscomp$1.destination &&
        flushCompletedQueues(request$jscomp$1, request$jscomp$1.destination);
    } catch (error: FZ.Thrown) {
      logRecoverableError(request$jscomp$1, error, {}),
        fatalError(request$jscomp$1, error);
    } finally {
      (currentResumableState = prevResumableState),
        (ReactSharedInternals.H = prevDispatcher),
        (ReactSharedInternals.A = prevAsyncDispatcher),
        prevDispatcher === HooksDispatcher && switchContext(prevContext),
        (currentRequest = prevRequest);
    }
  }
}
function preparePreambleFromSubtree(
  request: FZ.Request,
  segment: FZ.Segment,
  collectedPreambleSegments: FZ.Segment[][]
): boolean {
  segment.preambleChildren.length &&
    collectedPreambleSegments.push(segment.preambleChildren);
  for (var pendingPreambles = !1, i: number = 0; i < segment.children.length; i++)
    pendingPreambles =
      preparePreambleFromSegment(
        request,
        segment.children[i],
        collectedPreambleSegments
      ) || pendingPreambles;
  return pendingPreambles;
}
function preparePreambleFromSegment(
  request: FZ.Request,
  segment: FZ.Segment,
  collectedPreambleSegments: FZ.Segment[][]
): boolean {
  var boundary = segment.boundary;
  if (null === boundary)
    return preparePreambleFromSubtree(
      request,
      segment,
      collectedPreambleSegments
    );
  var preamble = boundary.preamble;
  if (null === preamble) return !1;
  switch (boundary.status) {
    case 1:
      hoistPreambleState(request.renderState, preamble.content);
      request.byteSize += boundary.byteSize;
      segment = boundary.completedSegments[0];
      if (!segment)
        throw Error(
          "A previously unvisited boundary must have exactly one root segment. This is a bug in React."
        );
      return preparePreambleFromSubtree(
        request,
        segment,
        collectedPreambleSegments
      );
    case 5:
      if (null !== request.trackedPostpones) return !0;
    case 4:
      if (1 === segment.status)
        return (
          hoistPreambleState(request.renderState, preamble.fallback),
          preparePreambleFromSubtree(
            request,
            segment,
            collectedPreambleSegments
          )
        );
    default:
      return !0;
  }
}
function preparePreamble(request: FZ.Request): void {
  if (
    request.completedRootSegment &&
    null === request.completedPreambleSegments
  ) {
    var collectedPreambleSegments: FZ.Segment[][] = [],
      originalRequestByteSize = request.byteSize,
      hasPendingPreambles = preparePreambleFromSegment(
        request,
        request.completedRootSegment,
        collectedPreambleSegments
      ),
      preamble = request.renderState.preamble;
    !1 === hasPendingPreambles || (preamble.headChunks && preamble.bodyChunks)
      ? (request.completedPreambleSegments = collectedPreambleSegments)
      : (request.byteSize = originalRequestByteSize);
  }
}
function flushSubtree(request: FZ.Request, destination: FZ.Destination, segment: FZ.Segment, hoistableState: FZ.HoistableState | null): boolean { /*$*/var request$asRenderState: FZ.RenderState, request$asHex: string, segment$asChildren: FZ.Segment[], hoistableState$asId: FZ.SegmentId, r$asSegment: FZ.Segment;/*$*/
  segment.parentFlushed = !0;
  switch (segment.status) {
    case 0:
      segment.id = request.nextSegmentId++;
    case 5:
      return (
        (hoistableState$asId = segment.id as FZ.SegmentId),
        (segment.lastPushedText = !1),
        (segment.textEmbedded = !1),
        (request$asRenderState = request.renderState),
        writeChunk(destination, '<template id="'),
        writeChunk(destination, request$asRenderState.placeholderPrefix),
        (request$asHex = hoistableState$asId.toString(16)),
        writeChunk(destination, request$asHex),
        !!destination.write('"></template>')
      );
    case 1:
      segment.status = 2;
      var r: boolean = !0,
        chunks = segment.chunks,
        chunkIdx: number = 0;
      segment$asChildren = segment.children;
      for (var childIdx: number = 0; childIdx < segment$asChildren.length; childIdx++) {
        for (r$asSegment = segment$asChildren[childIdx]; chunkIdx < r$asSegment.index; chunkIdx++)
          writeChunk(destination, chunks[chunkIdx]);
        r = flushSegment(request, destination, r$asSegment, hoistableState);
      }
      for (; chunkIdx < chunks.length - 1; chunkIdx++)
        writeChunk(destination, chunks[chunkIdx]);
      chunkIdx < chunks.length && (r = !!destination.write(chunks[chunkIdx]));
      return r;
    case 3:
      return !0;
    default:
      throw Error(
        "Aborted, errored or already flushed boundaries should not be flushed again. This is a bug in React."
      );
  }
}
var flushedByteSize: FZ.ByteSize = 0;
function flushSegment(request: FZ.Request, destination: FZ.Destination, segment: FZ.Segment, hoistableState: FZ.HoistableState | null): boolean { /*$*/var boundary$asDigest: FZ.ErrorDigest, segment$asRow: FZ.SuspenseListRow | null, segment$asSegments: FZ.Segment[];/*$*/
  var boundary: FZ.SuspenseBoundary | null = segment.boundary;
  if (null === boundary)
    return flushSubtree(request, destination, segment, hoistableState);
  segment.boundary = null;
  boundary.parentFlushed = !0;
  if (4 === boundary.status) {
    var row = boundary.row;
    null !== row &&
      0 === --row.pendingTasks &&
      finishSuspenseListRow(request, row);
    boundary$asDigest = boundary.errorDigest;
    destination.write("\x3c!--$!--\x3e");
    writeChunk(destination, "<template");
    null != boundary$asDigest &&
      (writeChunk(destination, ' data-dgst="'),
      writeChunk(destination, escapeTextForBrowser(boundary$asDigest)),
      writeChunk(destination, '"'));
    destination.write("></template>");
    flushSubtree(request, destination, segment, hoistableState);
  } else if (1 !== boundary.status)
    0 === boundary.status && (boundary.rootSegmentID = request.nextSegmentId++),
      0 < boundary.completedSegments.length &&
        request.partialBoundaries.push(boundary),
      writeStartPendingSuspenseBoundary(
        destination,
        request.renderState,
        boundary.rootSegmentID as FZ.SegmentId
      ),
      hoistableState && hoistHoistables(hoistableState, boundary.fallbackState),
      flushSubtree(request, destination, segment, hoistableState);
  else if (
    !flushingPartialBoundaries &&
    isEligibleForOutlining(request, boundary) &&
    (flushedByteSize + boundary.byteSize > request.progressiveChunkSize ||
      hasSuspenseyContent(boundary.contentState, flushingShell) ||
      boundary.defer)
  )
    (boundary.rootSegmentID = request.nextSegmentId++),
      request.completedBoundaries.push(boundary),
      writeStartPendingSuspenseBoundary(
        destination,
        request.renderState,
        boundary.rootSegmentID as FZ.SegmentId
      ),
      flushSubtree(request, destination, segment, hoistableState);
  else {
    flushedByteSize += boundary.byteSize;
    hoistableState && hoistHoistables(hoistableState, boundary.contentState);
    segment$asRow = boundary.row;
    null !== segment$asRow &&
      isEligibleForOutlining(request, boundary) &&
      0 === --segment$asRow.pendingTasks &&
      finishSuspenseListRow(request, segment$asRow);
    destination.write("\x3c!--$--\x3e");
    segment$asSegments = boundary.completedSegments;
    if (1 !== segment$asSegments.length)
      throw Error(
        "A previously unvisited boundary must have exactly one root segment. This is a bug in React."
      );
    flushSegment(request, destination, segment$asSegments[0], hoistableState);
  }
  return !!destination.write("\x3c!--/$--\x3e");
}
function flushSegmentContainer(request: FZ.Request, destination: FZ.Destination, segment: FZ.Segment, hoistableState: FZ.HoistableState): boolean {
  writeStartSegment(
    destination,
    request.renderState,
    segment.parentFormatContext,
    segment.id as FZ.SegmentId
  );
  flushSegment(request, destination, segment, hoistableState);
  return writeEndSegment(destination, segment.parentFormatContext);
}
function flushCompletedBoundary(request$given: FZ.Request, destination: FZ.Destination, boundary$given: FZ.SuspenseBoundary): boolean { /*$*/var request: FZ.Request, boundary: FZ.SuspenseBoundary; request = request$given; boundary = boundary$given; var request$asRenderState: FZ.RenderState; var boundary$asHoistables: FZ.HoistableState; var boundary$asWritten: boolean; var completedSegments$asRow: FZ.SuspenseListRow | null, completedSegments$asResumableState: FZ.ResumableState, completedSegments$asId: string;/*$*/
  flushedByteSize = boundary.byteSize;
  for (
    var completedSegments = boundary.completedSegments, i: number = 0;
    i < completedSegments.length;
    i++
  )
    flushPartiallyCompletedSegment(
      request,
      destination,
      boundary,
      completedSegments[i]
    );
  completedSegments.length = 0;
  completedSegments$asRow = boundary.row;
  null !== completedSegments$asRow &&
    isEligibleForOutlining(request, boundary) &&
    0 === --completedSegments$asRow.pendingTasks &&
    finishSuspenseListRow(request, completedSegments$asRow);
  writeHoistablesForBoundary(
    destination,
    boundary.contentState,
    request.renderState
  );
  completedSegments$asResumableState = request.resumableState;
  request$asRenderState = request.renderState;
  i = boundary.rootSegmentID;
  boundary$asHoistables = boundary.contentState;
  var requiresStyleInsertion = request$asRenderState.stylesToHoist,
    requiresViewTransitions = 0 !== (completedSegments$asResumableState.instructions & 128);
  request$asRenderState.stylesToHoist = !1;
  writeChunk(destination, request$asRenderState.startInlineScript);
  writeChunk(destination, ">");
  requiresStyleInsertion
    ? (0 === (completedSegments$asResumableState.instructions & 4) &&
        ((completedSegments$asResumableState.instructions |= 4),
        writeChunk(
          destination,
          '$RX=function(b,c,d,e,f){var a=document.getElementById(b);a&&(b=a.previousSibling,b.data="$!",a=a.dataset,null!=c&&(a.dgst=c),d&&(a.msg=d),e&&(a.stck=e),f&&(a.cstck=f),b._reactRetry&&b._reactRetry())};'
        )),
      0 === (completedSegments$asResumableState.instructions & 2) &&
        ((completedSegments$asResumableState.instructions |= 2),
        writeChunk(
          destination,
          '$RB=[];$RV=function(a){$RT=performance.now();for(var b=0;b<a.length;b+=2){var c=a[b],e=a[b+1];null!==e.parentNode&&e.parentNode.removeChild(e);var f=c.parentNode;if(f){var g=c.previousSibling,h=0;do{if(c&&8===c.nodeType){var d=c.data;if("/$"===d||"/&"===d)if(0===h)break;else h--;else"$"!==d&&"$?"!==d&&"$~"!==d&&"$!"!==d&&"&"!==d||h++}d=c.nextSibling;f.removeChild(c);c=d}while(c);for(;e.firstChild;)f.insertBefore(e.firstChild,c);g.data="$";g._reactRetry&&requestAnimationFrame(g._reactRetry)}}a.length=0};\n$RC=function(a,b){if(b=document.getElementById(b))(a=document.getElementById(a))?(a.previousSibling.data="$~",$RB.push(a,b),2===$RB.length&&("number"!==typeof $RT?requestAnimationFrame($RV.bind(null,$RB)):(a=performance.now(),setTimeout($RV.bind(null,$RB),2300>a&&2E3<a?2300-a:$RT+300-a)))):b.parentNode.removeChild(b)};'
        )),
      requiresViewTransitions &&
        0 === (completedSegments$asResumableState.instructions & 256) &&
        ((completedSegments$asResumableState.instructions |= 256),
        writeChunk(
          destination,
          '$RV=function(B,g){function h(a,c){var e=a.getAttribute(c);e&&(c=a.style,l.push(a,c.viewTransitionName,c.viewTransitionClass),"auto"!==e&&(c.viewTransitionClass=e),(a=a.getAttribute("vt-name"))||(a="_T_"+N++ +"_"),a=CSS.escape(a)!==a?"r-"+btoa(a).replace(/=/g,""):a,c.viewTransitionName=a,C=!0)}var C=!1,N=0,l=[];try{var f=document.__reactViewTransition;if(f){f.finished.finally($RV.bind(null,g));return}var m=new Map;for(f=1;f<g.length;f+=2)for(var k=g[f].querySelectorAll("[vt-share]"),d=0;d<k.length;d++){var b=k[d];m.set(b.getAttribute("vt-name"),b)}var u=[];for(k=0;k<g.length;k+=2){var D=g[k],x=D.parentNode;if(x){var v=x.getBoundingClientRect();if(v.left||v.top||v.width||v.height){b=D;for(f=0;b;){if(8===b.nodeType){var t=b.data;if("/$"===t)if(0===f)break;else f--;else"$"!==t&&"$?"!==t&&"$~"!==t&&"$!"!==t||f++}else if(1===b.nodeType){d=b;var E=d.getAttribute("vt-name"),y=m.get(E);h(d,y?"vt-share":"vt-exit");y&&(h(y,"vt-share"),m.set(E,null));for(var F=d.querySelectorAll("[vt-share]"),\nz=0;z<F.length;z++){var G=F[z],H=G.getAttribute("vt-name"),I=m.get(H);I&&(h(G,"vt-share"),h(I,"vt-share"),m.set(H,null))}var J=d.querySelectorAll("[vt-parent-exit]");for(d=0;d<J.length;d++)h(J[d],"vt-parent-exit")}b=b.nextSibling}for(var K=g[k+1],n=K.firstElementChild;n;){null!==m.get(n.getAttribute("vt-name"))&&h(n,"vt-enter");var L=n.querySelectorAll("[vt-parent-enter]");for(b=0;b<L.length;b++)h(L[b],"vt-parent-enter");n=n.nextElementSibling}b=x;do for(var p=b.firstElementChild;p;){var M=p.getAttribute("vt-update");\nM&&"none"!==M&&!l.includes(p)&&h(p,"vt-update");p=p.nextElementSibling}while((b=b.parentNode)&&1===b.nodeType&&"none"!==b.getAttribute("vt-update"));u.push.apply(u,K.querySelectorAll(\'img[src]:not([loading="lazy"])\'))}}}if(C){var A=document.__reactViewTransition=document.startViewTransition({update:function(){B(g);for(var a=[document.documentElement.clientHeight,document.fonts.ready],c={},e=0;e<u.length;c={g:c.g},e++)if(c.g=u[e],!c.g.complete){var q=c.g.getBoundingClientRect();0<q.bottom&&0<q.right&&\nq.top<window.innerHeight&&q.left<window.innerWidth&&(q=new Promise(function(w){return function(r){w.g.addEventListener("load",r);w.g.addEventListener("error",r)}}(c)),a.push(q))}return Promise.race([Promise.all(a),new Promise(function(w){var r=performance.now();setTimeout(w,2300>r&&2E3<r?2300-r:500)})])},types:[]});A.ready.finally(function(){for(var a=l.length-3;0<=a;a-=3){var c=l[a],e=c.style;e.viewTransitionName=l[a+1];e.viewTransitionClass=l[a+1];""===c.getAttribute("style")&&c.removeAttribute("style")}});\nA.finished.finally(function(){document.__reactViewTransition===A&&(document.__reactViewTransition=null)});$RB=[];return}}catch(a){}B(g)}.bind(null,$RV);'
        )),
      0 === (completedSegments$asResumableState.instructions & 8)
        ? ((completedSegments$asResumableState.instructions |= 8),
          writeChunk(
            destination,
            '$RM=new Map;$RR=function(n,w,p){function u(q){this._p=null;q()}for(var r=new Map,t=document,h,b,e=t.querySelectorAll("link[data-precedence],style[data-precedence]"),v=[],k=0;b=e[k++];)"not all"===b.getAttribute("media")?v.push(b):("LINK"===b.tagName&&$RM.set(b.getAttribute("href"),b),r.set(b.dataset.precedence,h=b));e=0;b=[];var l,a;for(k=!0;;){if(k){var f=p[e++];if(!f){k=!1;e=0;continue}var c=!1,m=0;var d=f[m++];if(a=$RM.get(d)){var g=a._p;c=!0}else{a=t.createElement("link");a.href=d;a.rel=\n"stylesheet";for(a.dataset.precedence=l=f[m++];g=f[m++];)a.setAttribute(g,f[m++]);g=a._p=new Promise(function(q,x){a.onload=u.bind(a,q);a.onerror=u.bind(a,x)});$RM.set(d,a)}d=a.getAttribute("media");!g||d&&!matchMedia(d).matches||b.push(g);if(c)continue}else{a=v[e++];if(!a)break;l=a.getAttribute("data-precedence");a.removeAttribute("media")}c=r.get(l)||h;c===h&&(h=a);r.set(l,a);c?c.parentNode.insertBefore(a,c.nextSibling):(c=t.head,c.insertBefore(a,c.firstChild))}if(p=document.getElementById(n))p.previousSibling.data=\n"$~";Promise.all(b).then($RC.bind(null,n,w),$RX.bind(null,n,"CSS failed to load"))};$RR("'
          ))
        : writeChunk(destination, '$RR("'))
    : (0 === (completedSegments$asResumableState.instructions & 2) &&
        ((completedSegments$asResumableState.instructions |= 2),
        writeChunk(
          destination,
          '$RB=[];$RV=function(a){$RT=performance.now();for(var b=0;b<a.length;b+=2){var c=a[b],e=a[b+1];null!==e.parentNode&&e.parentNode.removeChild(e);var f=c.parentNode;if(f){var g=c.previousSibling,h=0;do{if(c&&8===c.nodeType){var d=c.data;if("/$"===d||"/&"===d)if(0===h)break;else h--;else"$"!==d&&"$?"!==d&&"$~"!==d&&"$!"!==d&&"&"!==d||h++}d=c.nextSibling;f.removeChild(c);c=d}while(c);for(;e.firstChild;)f.insertBefore(e.firstChild,c);g.data="$";g._reactRetry&&requestAnimationFrame(g._reactRetry)}}a.length=0};\n$RC=function(a,b){if(b=document.getElementById(b))(a=document.getElementById(a))?(a.previousSibling.data="$~",$RB.push(a,b),2===$RB.length&&("number"!==typeof $RT?requestAnimationFrame($RV.bind(null,$RB)):(a=performance.now(),setTimeout($RV.bind(null,$RB),2300>a&&2E3<a?2300-a:$RT+300-a)))):b.parentNode.removeChild(b)};'
        )),
      requiresViewTransitions &&
        0 === (completedSegments$asResumableState.instructions & 256) &&
        ((completedSegments$asResumableState.instructions |= 256),
        writeChunk(
          destination,
          '$RV=function(B,g){function h(a,c){var e=a.getAttribute(c);e&&(c=a.style,l.push(a,c.viewTransitionName,c.viewTransitionClass),"auto"!==e&&(c.viewTransitionClass=e),(a=a.getAttribute("vt-name"))||(a="_T_"+N++ +"_"),a=CSS.escape(a)!==a?"r-"+btoa(a).replace(/=/g,""):a,c.viewTransitionName=a,C=!0)}var C=!1,N=0,l=[];try{var f=document.__reactViewTransition;if(f){f.finished.finally($RV.bind(null,g));return}var m=new Map;for(f=1;f<g.length;f+=2)for(var k=g[f].querySelectorAll("[vt-share]"),d=0;d<k.length;d++){var b=k[d];m.set(b.getAttribute("vt-name"),b)}var u=[];for(k=0;k<g.length;k+=2){var D=g[k],x=D.parentNode;if(x){var v=x.getBoundingClientRect();if(v.left||v.top||v.width||v.height){b=D;for(f=0;b;){if(8===b.nodeType){var t=b.data;if("/$"===t)if(0===f)break;else f--;else"$"!==t&&"$?"!==t&&"$~"!==t&&"$!"!==t||f++}else if(1===b.nodeType){d=b;var E=d.getAttribute("vt-name"),y=m.get(E);h(d,y?"vt-share":"vt-exit");y&&(h(y,"vt-share"),m.set(E,null));for(var F=d.querySelectorAll("[vt-share]"),\nz=0;z<F.length;z++){var G=F[z],H=G.getAttribute("vt-name"),I=m.get(H);I&&(h(G,"vt-share"),h(I,"vt-share"),m.set(H,null))}var J=d.querySelectorAll("[vt-parent-exit]");for(d=0;d<J.length;d++)h(J[d],"vt-parent-exit")}b=b.nextSibling}for(var K=g[k+1],n=K.firstElementChild;n;){null!==m.get(n.getAttribute("vt-name"))&&h(n,"vt-enter");var L=n.querySelectorAll("[vt-parent-enter]");for(b=0;b<L.length;b++)h(L[b],"vt-parent-enter");n=n.nextElementSibling}b=x;do for(var p=b.firstElementChild;p;){var M=p.getAttribute("vt-update");\nM&&"none"!==M&&!l.includes(p)&&h(p,"vt-update");p=p.nextElementSibling}while((b=b.parentNode)&&1===b.nodeType&&"none"!==b.getAttribute("vt-update"));u.push.apply(u,K.querySelectorAll(\'img[src]:not([loading="lazy"])\'))}}}if(C){var A=document.__reactViewTransition=document.startViewTransition({update:function(){B(g);for(var a=[document.documentElement.clientHeight,document.fonts.ready],c={},e=0;e<u.length;c={g:c.g},e++)if(c.g=u[e],!c.g.complete){var q=c.g.getBoundingClientRect();0<q.bottom&&0<q.right&&\nq.top<window.innerHeight&&q.left<window.innerWidth&&(q=new Promise(function(w){return function(r){w.g.addEventListener("load",r);w.g.addEventListener("error",r)}}(c)),a.push(q))}return Promise.race([Promise.all(a),new Promise(function(w){var r=performance.now();setTimeout(w,2300>r&&2E3<r?2300-r:500)})])},types:[]});A.ready.finally(function(){for(var a=l.length-3;0<=a;a-=3){var c=l[a],e=c.style;e.viewTransitionName=l[a+1];e.viewTransitionClass=l[a+1];""===c.getAttribute("style")&&c.removeAttribute("style")}});\nA.finished.finally(function(){document.__reactViewTransition===A&&(document.__reactViewTransition=null)});$RB=[];return}}catch(a){}B(g)}.bind(null,$RV);'
        )),
      writeChunk(destination, '$RC("'));
  completedSegments$asId = i.toString(16);
  writeChunk(destination, request$asRenderState.boundaryPrefix);
  writeChunk(destination, completedSegments$asId);
  writeChunk(destination, '","');
  writeChunk(destination, request$asRenderState.segmentPrefix);
  writeChunk(destination, completedSegments$asId);
  requiresStyleInsertion
    ? (writeChunk(destination, '",'),
      writeStyleResourceDependenciesInJS(destination, boundary$asHoistables))
    : writeChunk(destination, '"');
  boundary$asWritten = !!destination.write(")\x3c/script>");
  return writeBootstrap(destination, request$asRenderState) && boundary$asWritten;
}
function flushPartiallyCompletedSegment(
  request$given: FZ.Request,
  destination$given: FZ.Destination,
  boundary$given: FZ.SuspenseBoundary,
  segment: FZ.Segment
): boolean { /*$*/var request, destination, boundary; request = request$given; destination = destination$given; boundary = boundary$given;/*$*/
  if (2 === segment.status) return !0;
  var hoistableState = boundary.contentState,
    segmentID: FZ.SegmentId | string = segment.id;
  if (-1 === segmentID) {
    if (-1 === (segment.id = boundary.rootSegmentID))
      throw Error(
        "A root segment ID must have been assigned by now. This is a bug in React."
      );
    return flushSegmentContainer(request, destination, segment, hoistableState);
  }
  if (segmentID === boundary.rootSegmentID)
    return flushSegmentContainer(request, destination, segment, hoistableState);
  flushSegmentContainer(request, destination, segment, hoistableState);
  boundary = request.resumableState;
  request = request.renderState;
  writeChunk(destination, request.startInlineScript);
  writeChunk(destination, ">");
  0 === (boundary.instructions & 1)
    ? ((boundary.instructions |= 1),
      writeChunk(
        destination,
        '$RS=function(a,b){a=document.getElementById(a);b=document.getElementById(b);for(a.parentNode.removeChild(a);a.firstChild;)b.parentNode.insertBefore(a.firstChild,b);b.parentNode.removeChild(b)};$RS("'
      ))
    : writeChunk(destination, '$RS("');
  writeChunk(destination, request.segmentPrefix);
  segmentID = segmentID.toString(16);
  writeChunk(destination, segmentID);
  writeChunk(destination, '","');
  writeChunk(destination, request.placeholderPrefix);
  writeChunk(destination, segmentID);
  destination = !!destination.write('")\x3c/script>');
  return destination;
}
var flushingPartialBoundaries: boolean = !1,
  flushingShell: boolean = !1;
function flushCompletedQueues(request: FZ.Request, destination: FZ.Destination): void { /*$*/var i$asPostponed: FZ.PostponedState | null, i$asResumable: FZ.ResumableState, renderState$jscomp$1$asDestination: FZ.Destination, clientRenderedBoundaries$asRequest: FZ.Request, boundary$asDestination: FZ.Destination;/*$*/
  try {
    if (!(0 < request.pendingRootTasks)) {
      var i: number,
        completedRootSegment: FZ.Segment | FZ.int32 | null = request.completedRootSegment;
      if (null !== completedRootSegment) {
        if (5 === completedRootSegment.status) return;
        var completedPreambleSegments: FZ.Segment[][] | FZ.int32 | null = request.completedPreambleSegments;
        if (null === completedPreambleSegments) return;
        flushedByteSize = request.byteSize;
        var resumableState: FZ.ResumableState | FZ.int32 = request.resumableState,
          renderState: FZ.RenderState | FZ.int32 = request.renderState,
          preamble = renderState.preamble,
          htmlChunks = preamble.htmlChunks,
          headChunks = preamble.headChunks,
          i$jscomp$0: number;
        if (htmlChunks) {
          for (i$jscomp$0 = 0; i$jscomp$0 < htmlChunks.length; i$jscomp$0++)
            writeChunk(destination, htmlChunks[i$jscomp$0]);
          if (headChunks)
            for (i$jscomp$0 = 0; i$jscomp$0 < headChunks.length; i$jscomp$0++)
              writeChunk(destination, headChunks[i$jscomp$0]);
          else
            writeChunk(destination, startChunkForTag("head")),
              writeChunk(destination, ">");
        } else if (headChunks)
          for (i$jscomp$0 = 0; i$jscomp$0 < headChunks.length; i$jscomp$0++)
            writeChunk(destination, headChunks[i$jscomp$0]);
        var charsetChunks = renderState.charsetChunks;
        for (i$jscomp$0 = 0; i$jscomp$0 < charsetChunks.length; i$jscomp$0++)
          writeChunk(destination, charsetChunks[i$jscomp$0]);
        charsetChunks.length = 0;
        renderState.preconnects.forEach(flushResource, destination);
        renderState.preconnects.clear();
        var viewportChunks = renderState.viewportChunks;
        for (i$jscomp$0 = 0; i$jscomp$0 < viewportChunks.length; i$jscomp$0++)
          writeChunk(destination, viewportChunks[i$jscomp$0]);
        viewportChunks.length = 0;
        renderState.fontPreloads.forEach(flushResource, destination);
        renderState.fontPreloads.clear();
        renderState.highImagePreloads.forEach(flushResource, destination);
        renderState.highImagePreloads.clear();
        currentlyFlushingRenderState = renderState;
        renderState.styles.forEach(flushStylesInPreamble, destination);
        currentlyFlushingRenderState = null;
        var importMapChunks = renderState.importMapChunks;
        for (i$jscomp$0 = 0; i$jscomp$0 < importMapChunks.length; i$jscomp$0++)
          writeChunk(destination, importMapChunks[i$jscomp$0]);
        importMapChunks.length = 0;
        renderState.bootstrapScripts.forEach(flushResource, destination);
        renderState.scripts.forEach(flushResource, destination);
        renderState.scripts.clear();
        renderState.bulkPreloads.forEach(flushResource, destination);
        renderState.bulkPreloads.clear();
        htmlChunks || headChunks || (resumableState.instructions |= 32);
        var hoistableChunks = renderState.hoistableChunks;
        for (i$jscomp$0 = 0; i$jscomp$0 < hoistableChunks.length; i$jscomp$0++)
          writeChunk(destination, hoistableChunks[i$jscomp$0]);
        for (
          resumableState = hoistableChunks.length = 0;
          resumableState < completedPreambleSegments.length;
          resumableState++
        ) {
          var segments = completedPreambleSegments[resumableState];
          for (renderState = 0; renderState < segments.length; renderState++)
            flushSegment(request, destination, segments[renderState], null);
        }
        var preamble$jscomp$0 = request.renderState.preamble,
          headChunks$jscomp$0 = preamble$jscomp$0.headChunks;
        (preamble$jscomp$0.htmlChunks || headChunks$jscomp$0) &&
          writeChunk(destination, endChunkForTag("head"));
        var bodyChunks = preamble$jscomp$0.bodyChunks;
        if (bodyChunks)
          for (
            completedPreambleSegments = 0;
            completedPreambleSegments < bodyChunks.length;
            completedPreambleSegments++
          )
            writeChunk(destination, bodyChunks[completedPreambleSegments]);
        flushingShell = !0;
        flushSegment(request, destination, completedRootSegment, null);
        flushingShell = !1;
        request.completedRootSegment = null;
        var renderState$jscomp$0 = request.renderState;
        if (
          0 !== request.allPendingTasks ||
          0 !== request.clientRenderedBoundaries.length ||
          0 !== request.completedBoundaries.length ||
          (null !== request.trackedPostpones &&
            (0 !== request.trackedPostpones.rootNodes.length ||
              null !== request.trackedPostpones.rootSlots))
        ) {
          var resumableState$jscomp$0 = request.resumableState;
          if (0 === (resumableState$jscomp$0.instructions & 64)) {
            resumableState$jscomp$0.instructions |= 64;
            writeChunk(destination, renderState$jscomp$0.startInlineScript);
            if (0 === (resumableState$jscomp$0.instructions & 32)) {
              resumableState$jscomp$0.instructions |= 32;
              var shellId = "_" + resumableState$jscomp$0.idPrefix + "R_";
              writeChunk(destination, ' id="');
              writeChunk(destination, escapeTextForBrowser(shellId));
              writeChunk(destination, '"');
            }
            writeChunk(destination, ">");
            writeChunk(
              destination,
              "requestAnimationFrame(function(){$RT=performance.now()});"
            );
            destination.write("\x3c/script>");
          }
        }
        writeBootstrap(destination, renderState$jscomp$0);
      }
      var renderState$jscomp$1 = request.renderState;
      completedRootSegment = 0;
      var viewportChunks$jscomp$0 = renderState$jscomp$1.viewportChunks;
      for (
        completedRootSegment = 0;
        completedRootSegment < viewportChunks$jscomp$0.length;
        completedRootSegment++
      )
        writeChunk(destination, viewportChunks$jscomp$0[completedRootSegment]);
      viewportChunks$jscomp$0.length = 0;
      renderState$jscomp$1.preconnects.forEach(flushResource, destination);
      renderState$jscomp$1.preconnects.clear();
      renderState$jscomp$1.fontPreloads.forEach(flushResource, destination);
      renderState$jscomp$1.fontPreloads.clear();
      renderState$jscomp$1.highImagePreloads.forEach(
        flushResource,
        destination
      );
      renderState$jscomp$1.highImagePreloads.clear();
      renderState$jscomp$1.styles.forEach(preloadLateStyles, destination);
      renderState$jscomp$1.scripts.forEach(flushResource, destination);
      renderState$jscomp$1.scripts.clear();
      renderState$jscomp$1.bulkPreloads.forEach(flushResource, destination);
      renderState$jscomp$1.bulkPreloads.clear();
      var hoistableChunks$jscomp$0 = renderState$jscomp$1.hoistableChunks;
      for (
        completedRootSegment = 0;
        completedRootSegment < hoistableChunks$jscomp$0.length;
        completedRootSegment++
      )
        writeChunk(destination, hoistableChunks$jscomp$0[completedRootSegment]);
      hoistableChunks$jscomp$0.length = 0;
      var clientRenderedBoundaries = request.clientRenderedBoundaries;
      for (i = 0; i < clientRenderedBoundaries.length; i++) {
        var boundary = clientRenderedBoundaries[i];
        renderState$jscomp$1$asDestination = destination;
        var resumableState$jscomp$1 = request.resumableState,
          renderState$jscomp$2 = request.renderState,
          id: FZ.SegmentId = boundary.rootSegmentID as FZ.SegmentId,
          errorDigest = boundary.errorDigest;
        writeChunk(
          renderState$jscomp$1$asDestination,
          renderState$jscomp$2.startInlineScript
        );
        writeChunk(renderState$jscomp$1$asDestination, ">");
        0 === (resumableState$jscomp$1.instructions & 4)
          ? ((resumableState$jscomp$1.instructions |= 4),
            writeChunk(
              renderState$jscomp$1$asDestination,
              '$RX=function(b,c,d,e,f){var a=document.getElementById(b);a&&(b=a.previousSibling,b.data="$!",a=a.dataset,null!=c&&(a.dgst=c),d&&(a.msg=d),e&&(a.stck=e),f&&(a.cstck=f),b._reactRetry&&b._reactRetry())};;$RX("'
            ))
          : writeChunk(renderState$jscomp$1$asDestination, '$RX("');
        writeChunk(renderState$jscomp$1$asDestination, renderState$jscomp$2.boundaryPrefix);
        writeChunk(renderState$jscomp$1$asDestination, id.toString(16));
        writeChunk(renderState$jscomp$1$asDestination, '"');
        null != errorDigest &&
          (writeChunk(renderState$jscomp$1$asDestination, ","),
          null == errorDigest
            ? writeChunk(renderState$jscomp$1$asDestination, "null")
            : writeChunk(
                renderState$jscomp$1$asDestination,
                escapeJSStringsForInstructionScripts(errorDigest)
              ));
        var JSCompiler_inline_result: boolean | FZ.int32 =
          !!renderState$jscomp$1$asDestination.write(")\x3c/script>");
        if (!JSCompiler_inline_result) {
          request.destination = null;
          i++;
          clientRenderedBoundaries.splice(0, i);
          return;
        }
      }
      clientRenderedBoundaries.splice(0, i);
      var completedBoundaries = request.completedBoundaries;
      for (i = 0; i < completedBoundaries.length; i++)
        if (
          !flushCompletedBoundary(request, destination, completedBoundaries[i])
        ) {
          request.destination = null;
          i++;
          completedBoundaries.splice(0, i);
          return;
        }
      completedBoundaries.splice(0, i);
      flushingPartialBoundaries = !0;
      var partialBoundaries = request.partialBoundaries;
      for (i = 0; i < partialBoundaries.length; i++) {
        var boundary$71 = partialBoundaries[i];
        a: {
          clientRenderedBoundaries$asRequest = request;
          boundary$asDestination = destination;
          flushedByteSize = boundary$71.byteSize;
          var completedSegments = boundary$71.completedSegments;
          for (
            JSCompiler_inline_result = 0;
            JSCompiler_inline_result < completedSegments.length;
            JSCompiler_inline_result++
          )
            if (
              !flushPartiallyCompletedSegment(
                clientRenderedBoundaries$asRequest,
                boundary$asDestination,
                boundary$71,
                completedSegments[JSCompiler_inline_result]
              )
            ) {
              JSCompiler_inline_result++;
              completedSegments.splice(0, JSCompiler_inline_result);
              var JSCompiler_inline_result$jscomp$0 = !1;
              break a;
            }
          completedSegments.splice(0, JSCompiler_inline_result);
          var row = boundary$71.row;
          null !== row &&
            row.together &&
            1 === boundary$71.pendingTasks &&
            (1 === row.pendingTasks
              ? unblockSuspenseListRow(
                  clientRenderedBoundaries$asRequest,
                  row,
                  row.hoistables
                )
              : row.pendingTasks--);
          JSCompiler_inline_result$jscomp$0 = writeHoistablesForBoundary(
            boundary$asDestination,
            boundary$71.contentState,
            clientRenderedBoundaries$asRequest.renderState
          );
        }
        if (!JSCompiler_inline_result$jscomp$0) {
          request.destination = null;
          i++;
          partialBoundaries.splice(0, i);
          return;
        }
      }
      partialBoundaries.splice(0, i);
      flushingPartialBoundaries = !1;
      var largeBoundaries = request.completedBoundaries;
      for (i = 0; i < largeBoundaries.length; i++)
        if (!flushCompletedBoundary(request, destination, largeBoundaries[i])) {
          request.destination = null;
          i++;
          largeBoundaries.splice(0, i);
          return;
        }
      largeBoundaries.splice(0, i);
    }
  } finally {
    (flushingPartialBoundaries = !1),
      (i$asPostponed = request.postponedState),
      null !== i$asPostponed && (i$asPostponed.nextSegmentId = request.nextSegmentId as FZ.SegmentId),
      0 === request.allPendingTasks &&
      0 === request.clientRenderedBoundaries.length &&
      0 === request.completedBoundaries.length
        ? ((request.flushScheduled = !1),
          (i$asResumable = request.resumableState),
          i$asResumable.hasBody && writeChunk(destination, endChunkForTag("body")),
          i$asResumable.hasHtml && writeChunk(destination, endChunkForTag("html")),
          flushBuffered(destination),
          endRenderLifetime(request),
          (request.status = 13),
          destination.end(),
          (request.destination = null))
        : flushBuffered(destination);
  }
}
function startWork(request: FZ.Request): void {
  request.flushScheduled = null !== request.destination;
  scheduleMicrotask(function () {
    return performWork(request);
  });
  setTimeout(function () {
    10 === request.status && (request.status = 11);
    null === request.trackedPostpones &&
      safelyEmitEarlyPreloads(request, 0 === request.pendingRootTasks);
  }, 0);
}
function enqueueFlush(request: FZ.Request): void {
  !1 === request.flushScheduled &&
    0 === request.pingedTasks.length &&
    null !== request.destination &&
    ((request.flushScheduled = !0),
    setTimeout(function () {
      var destination = request.destination;
      destination
        ? flushCompletedQueues(request, destination)
        : (request.flushScheduled = !1);
    }, 0));
}
function startFlowing(request$given: FZ.Request, destination: FZ.Destination): void { /*$*/var request; request = request$given;/*$*/
  if (12 === request.status)
    (request.status = 13),
      (request = request.fatalError),
      isRecoverableError(request) &&
        (request = cloneRecoverableErrorAsFatal(request)),
      closeWithError(destination, request);
  else if (13 !== request.status && null === request.destination) {
    request.destination = destination;
    try {
      flushCompletedQueues(request, destination);
    } catch (error$73: FZ.Thrown) {
      logRecoverableError(request, error$73, {}), fatalError(request, error$73);
    }
  }
}
function finishAbort(request: FZ.Request, abortableTasks: Set<FZ.Task>): void {
  try {
    if (0 < abortableTasks.size) {
      var error: FZ.Thrown = request.fatalError;
      abortableTasks.forEach(function (task) {
        return finishAbortedTask(task, request, error);
      });
      abortableTasks.clear();
    }
    null !== request.destination &&
      flushCompletedQueues(request, request.destination);
  } catch (error$74: FZ.Thrown) {
    logRecoverableError(request, error$74, {}), fatalError(request, error$74);
  }
}
function endRenderLifetime(request$given: FZ.Request): void { /*$*/var request; request = request$given;/*$*/
  request = request.renderLifetimeController;
  null !== request && request.abort("The render ended.");
}
function attachAbortSignal(request: FZ.Request, signal: FZ.AbortSignalGiven): void {
  if (signal.aborted) abort(request, signal.reason);
  else {
    var renderLifetimeController: FZ.AbortControllerGiven = new AbortController();
    request.renderLifetimeController = renderLifetimeController;
    signal.addEventListener(
      "abort",
      function () {
        abort(request, signal.reason);
      },
      { signal: renderLifetimeController.signal }
    );
  }
}
function abort(request: FZ.Request, reason: FZ.Thrown): void {
  if (!(request.aborted || (11 !== request.status && 10 !== request.status))) {
    endRenderLifetime(request);
    var isRecoverableReason =
      "object" === typeof reason &&
      null !== reason &&
      reason.$$typeof === REACT_RECOVERABLE_TYPE;
    request.aborted = !0;
    reason = isRecoverableReason
      ? createRecoverableError(reason)
      : void 0 === reason
        ? Error("The render was aborted by the server without a reason.")
        : "object" === typeof reason &&
            null !== reason &&
            "function" === typeof reason.then
          ? Error("The render was aborted by the server with a promise.")
          : reason;
    request.fatalError = reason;
    var abortableTasks = request.abortableTasks;
    abortableTasks.forEach(function (task) {
      return abortTask(task, request);
    });
    setTimeout(function () {
      return finishAbort(request, abortableTasks);
    }, 0);
  }
}
function addToReplayParent(node: FZ.ReplayNode, parentKeyPath: FZ.KeyNode | null, trackedPostpones: FZ.PostponedHoles): void {
  if (null === parentKeyPath) trackedPostpones.rootNodes.push(node);
  else {
    var workingMap = trackedPostpones.workingMap,
      parentNode: FZ.ReplayNode | undefined = workingMap.get(parentKeyPath);
    void 0 === parentNode &&
      ((parentNode = [parentKeyPath[1], parentKeyPath[2], [], null]),
      workingMap.set(parentKeyPath, parentNode),
      addToReplayParent(parentNode, parentKeyPath[0], trackedPostpones));
    parentNode[2].push(node);
  }
}
function getPostponedState(request: FZ.Request): FZ.PostponedState | null { /*$*/var trackedPostpones$asState: FZ.PostponedState;/*$*/
  var trackedPostpones = request.trackedPostpones;
  if (
    null === trackedPostpones ||
    (0 === trackedPostpones.rootNodes.length &&
      null === trackedPostpones.rootSlots)
  )
    return (request.trackedPostpones = null);
  var hasFlushableShell =
    null === request.completedRootSegment ||
    (5 !== request.completedRootSegment.status &&
      null !== request.completedPreambleSegments);
  if (hasFlushableShell) {
    var nextSegmentId: FZ.SegmentId = request.nextSegmentId as FZ.SegmentId;
    var replaySlots: FZ.ResumeSlots = trackedPostpones.rootSlots;
    var resumableState = request.resumableState;
    resumableState.bootstrapScriptContent = void 0;
    resumableState.bootstrapScripts = void 0;
    resumableState.bootstrapModules = void 0;
  } else {
    nextSegmentId = 0;
    replaySlots = -1;
    resumableState = request.resumableState;
    var renderState = request.renderState;
    resumableState.nextFormID = 0;
    resumableState.hasBody = !1;
    resumableState.hasHtml = !1;
    resumableState.unknownResources = { font: renderState.resets.font };
    resumableState.dnsResources = renderState.resets.dns;
    resumableState.connectResources = renderState.resets.connect;
    resumableState.imageResources = renderState.resets.image;
    resumableState.styleResources = renderState.resets.style;
    resumableState.scriptResources = {};
    resumableState.moduleUnknownResources = {};
    resumableState.moduleScriptResources = {};
    resumableState.instructions = 0;
  }
  trackedPostpones$asState = {
    nextSegmentId: nextSegmentId,
    rootFormatContext: request.rootFormatContext,
    progressiveChunkSize: request.progressiveChunkSize,
    resumableState: request.resumableState,
    replayNodes: trackedPostpones.rootNodes,
    replaySlots: replaySlots
  };
  hasFlushableShell && (request.postponedState = trackedPostpones$asState);
  return trackedPostpones$asState;
}
function ensureCorrectIsomorphicReactVersion(): void {
  var isomorphicReactPackageVersion = React.version;
  if ("19.3.0" !== isomorphicReactPackageVersion)
    throw Error(
      'Incompatible React versions: The "react" and "react-dom" packages must have the exact same version. Instead got:\n  - react:      ' +
        (isomorphicReactPackageVersion +
          "\n  - react-dom:  19.3.0\nLearn more: https://react.dev/warnings/version-mismatch")
    );
}
ensureCorrectIsomorphicReactVersion();
var textEncoder: FZ.TextEncoderGiven = new util.TextEncoder();
ensureCorrectIsomorphicReactVersion();
function createDrainHandler(destination: FZ.Destination, request: FZ.Request): () => void {
  return function () {
    return startFlowing(request, destination);
  };
}
function createCancelHandler(request: FZ.Request, reason: string): () => void {
  return function () {
    request.destination = null;
    abort(request, Error(reason));
  };
}
function createRequestImpl(children: FZ.ReactNode, options: FZ.Options): FZ.Request {
  var resumableState = createResumableState(
    options ? options.identifierPrefix : void 0,
    options ? options.unstable_externalRuntimeSrc : void 0,
    options ? options.bootstrapScriptContent : void 0,
    options ? options.bootstrapScripts : void 0,
    options ? options.bootstrapModules : void 0
  );
  return createRequest(
    children,
    resumableState,
    createRenderState(
      resumableState,
      options ? options.nonce : void 0,
      options ? options.unstable_externalRuntimeSrc : void 0,
      options ? options.importMap : void 0,
      options ? options.onHeaders : void 0,
      options ? options.maxHeadersLength : void 0
    ),
    createRootFormatContext(options ? options.namespaceURI : void 0),
    options ? options.progressiveChunkSize : void 0,
    options ? options.onError : void 0,
    options ? options.onBrowserBailout : void 0,
    options ? options.onAllReady : void 0,
    options ? options.onShellReady : void 0,
    options ? options.onShellError : void 0,
    void 0,
    options ? options.formState : void 0
  );
}
function createFakeWritableFromReadableStreamController$1(controller: FZ.StreamController): FZ.FakeWritable {
  return {
    write: function (chunk) {
      "string" === typeof chunk && (chunk = textEncoder.encode(chunk));
      controller.enqueue(chunk);
      return !0;
    },
    end: function () {
      controller.close();
    },
    destroy: function (error) {
      "function" === typeof controller.error
        ? controller.error(error)
        : controller.close();
    }
  };
}
function resumeRequestImpl(children: FZ.ReactNode, postponedState: FZ.PostponedStateGiven, options: FZ.Options): FZ.Request {
  return resumeRequest(
    children,
    postponedState,
    createRenderState(
      postponedState.resumableState,
      options ? options.nonce : void 0,
      void 0,
      void 0,
      void 0,
      void 0
    ),
    options ? options.onError : void 0,
    options ? options.onBrowserBailout : void 0,
    options ? options.onAllReady : void 0,
    options ? options.onShellReady : void 0,
    options ? options.onShellError : void 0,
    void 0
  );
}
ensureCorrectIsomorphicReactVersion();
function createFakeWritableFromReadableStreamController(controller: FZ.StreamController): FZ.FakeWritable {
  return {
    write: function (chunk) {
      "string" === typeof chunk && (chunk = textEncoder.encode(chunk));
      controller.enqueue(chunk);
      return !0;
    },
    end: function () {
      controller.close();
    },
    destroy: function (error) {
      "function" === typeof controller.error
        ? controller.error(error)
        : controller.close();
    }
  };
}
function createFakeWritableFromReadable(readable: FZ.NodeReadable): FZ.FakeWritable {
  return {
    write: function (chunk) {
      return readable.push(chunk);
    },
    end: function () {
      readable.push(null);
    },
    destroy: function (error) {
      readable.destroy(error);
    }
  };
}
exports.prerender = function (children: FZ.ReactNode, options: FZ.Options): Promise<FZ.StaticResult> {
  return new Promise(function (resolve, reject) {
    var onHeaders = options ? options.onHeaders : void 0,
      onHeadersImpl: FZ.OnHeaders | undefined;
    onHeaders &&
      (onHeadersImpl = function (headersDescriptor) {
        onHeaders(new Headers(headersDescriptor));
      });
    var resources = createResumableState(
        options ? options.identifierPrefix : void 0,
        options ? options.unstable_externalRuntimeSrc : void 0,
        options ? options.bootstrapScriptContent : void 0,
        options ? options.bootstrapScripts : void 0,
        options ? options.bootstrapModules : void 0
      ),
      request = createPrerenderRequest(
        children,
        resources,
        createRenderState(
          resources,
          void 0,
          options ? options.unstable_externalRuntimeSrc : void 0,
          options ? options.importMap : void 0,
          onHeadersImpl,
          options ? options.maxHeadersLength : void 0
        ),
        createRootFormatContext(options ? options.namespaceURI : void 0),
        options ? options.progressiveChunkSize : void 0,
        options ? options.onError : void 0,
        options ? options.onBrowserBailout : void 0,
        function () { /*$*/var stream$asResult: FZ.StaticResult;/*$*/
          var writable: FZ.FakeWritable | undefined,
            stream = new ReadableStream(
              {
                type: "bytes",
                start: function (controller: FZ.StreamController) {
                  writable =
                    createFakeWritableFromReadableStreamController(controller);
                },
                pull: function () {
                  startFlowing(request, writable);
                },
                cancel: function (reason: FZ.Thrown) {
                  request.destination = null;
                  abort(request, reason);
                }
              },
              { highWaterMark: 0 }
            );
          stream$asResult = { postponed: getPostponedState(request), prelude: stream };
          resolve(stream$asResult);
        },
        void 0,
        void 0,
        reject
      );
    options && options.signal && attachAbortSignal(request, options.signal);
    startWork(request);
  });
};
exports.prerenderToNodeStream = function (children: FZ.ReactNode, options: FZ.Options): Promise<FZ.StaticResult> {
  return new Promise(function (resolve, reject) {
    var resumableState = createResumableState(
        options ? options.identifierPrefix : void 0,
        options ? options.unstable_externalRuntimeSrc : void 0,
        options ? options.bootstrapScriptContent : void 0,
        options ? options.bootstrapScripts : void 0,
        options ? options.bootstrapModules : void 0
      ),
      request = createPrerenderRequest(
        children,
        resumableState,
        createRenderState(
          resumableState,
          void 0,
          options ? options.unstable_externalRuntimeSrc : void 0,
          options ? options.importMap : void 0,
          options ? options.onHeaders : void 0,
          options ? options.maxHeadersLength : void 0
        ),
        createRootFormatContext(options ? options.namespaceURI : void 0),
        options ? options.progressiveChunkSize : void 0,
        options ? options.onError : void 0,
        options ? options.onBrowserBailout : void 0,
        function () { /*$*/var readable$asResult: FZ.StaticResult;/*$*/
          var readable = new stream.Readable({
              read: function () {
                startFlowing(request, writable);
              }
            }),
            writable = createFakeWritableFromReadable(readable);
          readable$asResult = {
            postponed: getPostponedState(request),
            prelude: readable
          };
          resolve(readable$asResult);
        },
        void 0,
        void 0,
        reject
      );
    options && options.signal && attachAbortSignal(request, options.signal);
    startWork(request);
  });
};
exports.renderToPipeableStream = function (children: FZ.ReactNode, options: FZ.Options): FZ.PipeableStream {
  var request = createRequestImpl(children, options),
    hasStartedFlowing = !1;
  startWork(request);
  return {
    pipe: function (destination) {
      if (hasStartedFlowing)
        throw Error(
          "React currently only supports piping to one writable stream."
        );
      hasStartedFlowing = !0;
      safelyEmitEarlyPreloads(
        request,
        null === request.trackedPostpones
          ? 0 === request.pendingRootTasks
          : null === request.completedRootSegment
            ? 0 === request.pendingRootTasks
            : 5 !== request.completedRootSegment.status
      );
      startFlowing(request, destination);
      destination.on("drain", createDrainHandler(destination, request));
      destination.on(
        "error",
        createCancelHandler(
          request,
          "The destination stream errored while writing data."
        )
      );
      destination.on(
        "close",
        createCancelHandler(request, "The destination stream closed early.")
      );
      return destination;
    },
    abort: function (reason) {
      abort(request, reason);
    }
  };
};
exports.renderToReadableStream = function (children: FZ.ReactNode, options: FZ.Options): Promise<FZ.WebReadableStream> {
  return new Promise(function (resolve, reject) {
    var onFatalError: ((error: FZ.Thrown) => void) | undefined,
      onAllReady: (() => void) | undefined,
      allReady: Promise<void> = new Promise(function (res, rej) {
        onAllReady = res;
        onFatalError = rej;
      }),
      onHeaders = options ? options.onHeaders : void 0,
      onHeadersImpl: FZ.OnHeaders | undefined;
    onHeaders &&
      (onHeadersImpl = function (headersDescriptor) {
        onHeaders(new Headers(headersDescriptor));
      });
    var resumableState = createResumableState(
        options ? options.identifierPrefix : void 0,
        options ? options.unstable_externalRuntimeSrc : void 0,
        options ? options.bootstrapScriptContent : void 0,
        options ? options.bootstrapScripts : void 0,
        options ? options.bootstrapModules : void 0
      ),
      request = createRequest(
        children,
        resumableState,
        createRenderState(
          resumableState,
          options ? options.nonce : void 0,
          options ? options.unstable_externalRuntimeSrc : void 0,
          options ? options.importMap : void 0,
          onHeadersImpl,
          options ? options.maxHeadersLength : void 0
        ),
        createRootFormatContext(options ? options.namespaceURI : void 0),
        options ? options.progressiveChunkSize : void 0,
        options ? options.onError : void 0,
        options ? options.onBrowserBailout : void 0,
        onAllReady,
        function () {
          var stream = new ReadableStream(
            {
              type: "direct",
              pull: function (controller: FZ.StreamController) {
                startFlowing(request, controller);
              },
              cancel: function (reason: FZ.Thrown) {
                request.destination = null;
                abort(request, reason);
              }
            },
            { highWaterMark: 2048 }
          );
          stream.allReady = allReady;
          resolve(stream);
        },
        function (error) {
          allReady.catch(function () {});
          reject(error);
        },
        onFatalError,
        options ? options.formState : void 0
      );
    options && options.signal && attachAbortSignal(request, options.signal);
    startWork(request);
  });
};
exports.resume = function (children: FZ.ReactNode, postponedState: FZ.PostponedStateGiven, options: FZ.Options): Promise<FZ.WebReadableStream> {
  return new Promise(function (resolve, reject) {
    var onFatalError: ((error: FZ.Thrown) => void) | undefined,
      onAllReady: (() => void) | undefined,
      allReady: Promise<void> = new Promise(function (res, rej) {
        onAllReady = res;
        onFatalError = rej;
      }),
      request = resumeRequest(
        children,
        postponedState,
        createRenderState(
          postponedState.resumableState,
          options ? options.nonce : void 0,
          void 0,
          void 0,
          void 0,
          void 0
        ),
        options ? options.onError : void 0,
        options ? options.onBrowserBailout : void 0,
        onAllReady,
        function () {
          var writable: FZ.FakeWritable | undefined,
            stream = new ReadableStream(
              {
                type: "bytes",
                start: function (controller: FZ.StreamController) {
                  writable =
                    createFakeWritableFromReadableStreamController$1(
                      controller
                    );
                },
                pull: function () {
                  startFlowing(request, writable);
                },
                cancel: function (reason: FZ.Thrown) {
                  request.destination = null;
                  abort(request, reason);
                }
              },
              { highWaterMark: 0 }
            );
          stream.allReady = allReady;
          resolve(stream);
        },
        function (error) {
          allReady.catch(function () {});
          reject(error);
        },
        onFatalError
      );
    options && options.signal && attachAbortSignal(request, options.signal);
    startWork(request);
  });
};
exports.resumeAndPrerender = function (children: FZ.ReactNode, postponedState: FZ.PostponedStateGiven, options: FZ.Options): Promise<FZ.StaticResult> {
  return new Promise(function (resolve, reject) {
    var request = resumeAndPrerenderRequest(
      children,
      postponedState,
      createRenderState(
        postponedState.resumableState,
        void 0,
        void 0,
        void 0,
        void 0,
        void 0
      ),
      options ? options.onError : void 0,
      options ? options.onBrowserBailout : void 0,
      function () { /*$*/var stream$asResult: FZ.StaticResult;/*$*/
        var writable: FZ.FakeWritable | undefined,
          stream = new ReadableStream(
            {
              type: "bytes",
              start: function (controller: FZ.StreamController) {
                writable =
                  createFakeWritableFromReadableStreamController(controller);
              },
              pull: function () {
                startFlowing(request, writable);
              },
              cancel: function (reason: FZ.Thrown) {
                request.destination = null;
                abort(request, reason);
              }
            },
            { highWaterMark: 0 }
          );
        stream$asResult = { postponed: getPostponedState(request), prelude: stream };
        resolve(stream$asResult);
      },
      void 0,
      void 0,
      reject
    );
    options && options.signal && attachAbortSignal(request, options.signal);
    startWork(request);
  });
};
exports.resumeAndPrerenderToNodeStream = function (
  children: FZ.ReactNode,
  postponedState: FZ.PostponedStateGiven,
  options: FZ.Options
): Promise<FZ.StaticResult> {
  return new Promise(function (resolve, reject) {
    var request = resumeAndPrerenderRequest(
      children,
      postponedState,
      createRenderState(
        postponedState.resumableState,
        void 0,
        void 0,
        void 0,
        void 0,
        void 0
      ),
      options ? options.onError : void 0,
      options ? options.onBrowserBailout : void 0,
      function () { /*$*/var readable$asResult: FZ.StaticResult;/*$*/
        var readable = new stream.Readable({
            read: function () {
              startFlowing(request, writable);
            }
          }),
          writable = createFakeWritableFromReadable(readable);
        readable$asResult = { postponed: getPostponedState(request), prelude: readable };
        resolve(readable$asResult);
      },
      void 0,
      void 0,
      reject
    );
    options && options.signal && attachAbortSignal(request, options.signal);
    startWork(request);
  });
};
exports.resumeToPipeableStream = function (children: FZ.ReactNode, postponedState: FZ.PostponedStateGiven, options: FZ.Options): FZ.PipeableStream {
  var request = resumeRequestImpl(children, postponedState, options),
    hasStartedFlowing = !1;
  startWork(request);
  return {
    pipe: function (destination) {
      if (hasStartedFlowing)
        throw Error(
          "React currently only supports piping to one writable stream."
        );
      hasStartedFlowing = !0;
      startFlowing(request, destination);
      destination.on("drain", createDrainHandler(destination, request));
      destination.on(
        "error",
        createCancelHandler(
          request,
          "The destination stream errored while writing data."
        )
      );
      destination.on(
        "close",
        createCancelHandler(request, "The destination stream closed early.")
      );
      return destination;
    },
    abort: function (reason) {
      abort(request, reason);
    }
  };
};
exports.version = "19.3.0";
