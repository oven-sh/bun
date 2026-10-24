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
function escapeTextForBrowser(text: FZ.PropValue | string): string {
  if (
    "boolean" === typeof text ||
    "number" === typeof text ||
    "bigint" === typeof text
  )
    return "" + text;
  text = "" + text;
  var match: RegExpExecArray | string | null = matchHtmlRegExp.exec((text as string));
  if (match) {
    var html = "",
      index: number,
      lastIndex: number = 0;
    for (index = match.index as number; index < (text as string).length; index++) {
      switch ((text as string).charCodeAt(index)) {
        case 34:
          match = "&quot;";
          break;
        case 38:
          match = "&amp;";
          break;
        case 39:
          match = "&#x27;";
          break;
        case 60:
          match = "&lt;";
          break;
        case 62:
          match = "&gt;";
          break;
        default:
          continue;
      }
      lastIndex !== index && (html += (text as string).slice(lastIndex, index));
      lastIndex = index + 1;
      html += match;
    }
    text = lastIndex !== index ? html + (text as string).slice(lastIndex, index) : html;
  }
  return (text as string);
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
} as FZ.HostDispatcher;
var PRELOAD_NO_CREDS: FZ.PreloadState = [],
  currentlyFlushingRenderState: FZ.RenderState | null = null,
  scriptRegex = /(<\/|<)(s)(cript)/gi;
function scriptReplacer(match: string, prefix: string, s: string, suffix: string): string {
  return "" + prefix + ("s" === s ? "\\u0073" : "\\u0053") + suffix;
}
function createRenderState(
  resumableState: FZ.ResumableState,
  nonce: FZ.Nonce | any,
  externalRuntimeConfig: FZ.PropValue,
  importMap: FZ.ImportMap | any,
  onHeaders: FZ.OnHeaders | FZ.RenderState | null | undefined,
  maxHeadersLength: FZ.PropValue
): FZ.RenderState {
  externalRuntimeConfig =
    "string" === typeof nonce ? nonce : nonce && nonce.script;
  var inlineScriptWithNonce: string | FZ.PropsBag | undefined =
      void 0 === externalRuntimeConfig
        ? "<script"
        : '<script nonce="' + escapeTextForBrowser(externalRuntimeConfig) + '"',
    nonceStyle: FZ.PropValue | FZ.ResumableState | FZ.Resource = "string" === typeof nonce ? void 0 : nonce && nonce.style,
    inlineStyleWithNonce: string | FZ.PropsBag | FZ.PropValue =
      void 0 === nonceStyle
        ? "<style"
        : '<style nonce="' + escapeTextForBrowser(nonceStyle) + '"',
    idPrefix: any | FZ.PropValue | FZ.ResumableState | FZ.Resource = resumableState.idPrefix,
    bootstrapChunks: FZ.Chunk[] = [],
    bootstrapScriptContent: any | FZ.Chunk[] = resumableState.bootstrapScriptContent,
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
  bootstrapScriptContent = [];
  void 0 !== importMap &&
    ((bootstrapScriptContent as FZ.Chunk[]).push(
      void 0 === externalRuntimeConfig
        ? '<script type="importmap">'
        : '<script type="importmap" nonce="' +
            escapeTextForBrowser(externalRuntimeConfig) +
            '">'
    ),
    (bootstrapScriptContent as FZ.Chunk[]).push(
      ("" + JSON.stringify(importMap)).replace(scriptRegex, scriptReplacer)
    ),
    (bootstrapScriptContent as FZ.Chunk[]).push("\x3c/script>"));
  importMap = (onHeaders as FZ.OnHeaders | null | undefined)
    ? {
        preconnects: "",
        fontPreloads: "",
        highImagePreloads: "",
        remainingCapacity:
          2 + ("number" === typeof maxHeadersLength ? maxHeadersLength : 2e3)
      } as FZ.PreloadHeaders
    : null;
  onHeaders = {
    placeholderPrefix: idPrefix + "P:",
    segmentPrefix: idPrefix + "S:",
    boundaryPrefix: idPrefix + "B:",
    startInlineScript: inlineScriptWithNonce,
    startInlineStyle: (inlineStyleWithNonce as string),
    preamble: createPreambleState(),
    externalRuntimeScript: null,
    bootstrapChunks: bootstrapChunks,
    importMapChunks: (bootstrapScriptContent as FZ.Chunk[]),
    onHeaders: (onHeaders as FZ.OnHeaders | null | undefined),
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
  } as FZ.RenderState;
  if (void 0 !== bootstrapScripts)
    for (importMap = 0; importMap < bootstrapScripts.length; importMap++)
      (idPrefix = bootstrapScripts[importMap]),
        (nonceStyle = inlineScriptWithNonce = void 0),
        (inlineStyleWithNonce = {
          rel: "preload",
          as: "script",
          fetchPriority: "low",
          nonce: nonce
        }),
        "string" === typeof idPrefix
          ? ((inlineStyleWithNonce as FZ.PropsBag).href = maxHeadersLength = idPrefix)
          : (((inlineStyleWithNonce as FZ.PropsBag).href = maxHeadersLength = idPrefix.src),
            ((inlineStyleWithNonce as FZ.PropsBag).integrity = nonceStyle =
              "string" === typeof idPrefix.integrity
                ? idPrefix.integrity
                : void 0),
            ((inlineStyleWithNonce as FZ.PropsBag).crossOrigin = inlineScriptWithNonce =
              "string" === typeof idPrefix || null == idPrefix.crossOrigin
                ? void 0
                : "use-credentials" === idPrefix.crossOrigin
                  ? "use-credentials"
                  : "")),
        (idPrefix = resumableState),
        (bootstrapScriptContent = maxHeadersLength),
        (idPrefix.scriptResources[bootstrapScriptContent] = null),
        (idPrefix.moduleScriptResources[bootstrapScriptContent] = null),
        (idPrefix = []),
        pushLinkImpl((idPrefix as FZ.Resource), (inlineStyleWithNonce as FZ.PropsBag)),
        onHeaders.bootstrapScripts.add((idPrefix as FZ.Resource)),
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
        (inlineScriptWithNonce = {
          rel: "modulepreload",
          fetchPriority: "low",
          nonce: externalRuntimeConfig
        }),
        "string" === typeof nonceStyle
          ? (inlineScriptWithNonce.href = bootstrapScripts = nonceStyle)
          : ((inlineScriptWithNonce.href = bootstrapScripts = nonceStyle.src),
            (inlineScriptWithNonce.integrity = maxHeadersLength =
              "string" === typeof nonceStyle.integrity
                ? nonceStyle.integrity
                : void 0),
            (inlineScriptWithNonce.crossOrigin = importMap =
              "string" === typeof nonceStyle || null == nonceStyle.crossOrigin
                ? void 0
                : "use-credentials" === nonceStyle.crossOrigin
                  ? "use-credentials"
                  : "")),
        (nonceStyle = resumableState),
        (inlineStyleWithNonce = bootstrapScripts),
        (nonceStyle.scriptResources[inlineStyleWithNonce] = null),
        (nonceStyle.moduleScriptResources[inlineStyleWithNonce] = null),
        (nonceStyle = []),
        pushLinkImpl((nonceStyle as FZ.Resource), inlineScriptWithNonce),
        onHeaders.bootstrapScripts.add((nonceStyle as FZ.Resource)),
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
  return onHeaders;
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
function getSuspenseContentFormatContext(resumableState: FZ.ResumableState, parentContext: FZ.FormatContext): FZ.FormatContext {
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
function makeId(resumableState: FZ.ResumableState | any, treeId: string, localId: number): string {
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
function pushViewTransitionAttributes(target: FZ.Chunk[], formatContext: FZ.FormatContext | FZ.ViewTransitionContext | null): void {
  formatContext = (formatContext as FZ.FormatContext).viewTransition;
  null !== formatContext &&
    ("auto" !== (formatContext as FZ.ViewTransitionContext).name &&
      (pushStringAttribute(
        target,
        "vt-name",
        0 === (formatContext as FZ.ViewTransitionContext).nameIdx
          ? (formatContext as FZ.ViewTransitionContext).name
          : (formatContext as FZ.ViewTransitionContext).name + "_" + (formatContext as FZ.ViewTransitionContext).nameIdx
      ),
      (formatContext as FZ.ViewTransitionContext).nameIdx++),
    pushStringAttribute(target, "vt-update", (formatContext as FZ.ViewTransitionContext).update),
    "none" !== (formatContext as FZ.ViewTransitionContext).enter &&
      pushStringAttribute(target, "vt-enter", (formatContext as FZ.ViewTransitionContext).enter),
    "none" !== (formatContext as FZ.ViewTransitionContext).exit &&
      pushStringAttribute(target, "vt-exit", (formatContext as FZ.ViewTransitionContext).exit),
    "none" !== (formatContext as FZ.ViewTransitionContext).share &&
      pushStringAttribute(target, "vt-share", (formatContext as FZ.ViewTransitionContext).share));
}
var styleNameCache: Map<string, FZ.Chunk> = new Map();
function pushStyleAttribute(target: FZ.Chunk[], style: FZ.PropValue): void {
  if ("object" !== typeof style)
    throw Error(
      "The `style` prop expects a mapping from style properties to values, not a string. For example, style={{marginRight: spacing + 'em'}} when using JSX."
    );
  var isFirst = !0,
    styleName: string;
  for (styleName in style)
    if (hasOwnProperty.call(style, styleName)) {
      var styleValue: FZ.PropValue | FZ.Chunk = style[styleName];
      if (
        null != styleValue &&
        "boolean" !== typeof styleValue &&
        "" !== styleValue
      ) {
        if (0 === styleName.indexOf("--")) {
          var nameChunk: FZ.Chunk | undefined = escapeTextForBrowser(styleName);
          styleValue = escapeTextForBrowser(("" + styleValue).trim());
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
            (styleValue =
              "number" === typeof styleValue
                ? 0 === styleValue || unitlessNumbers.has(styleName)
                  ? "" + styleValue
                  : styleValue + "px"
                : escapeTextForBrowser(("" + styleValue).trim()));
        isFirst
          ? ((isFirst = !1),
            target.push(' style="', nameChunk, ":", (styleValue as FZ.Chunk)))
          : target.push(";", nameChunk, ":", (styleValue as FZ.Chunk));
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
function getCustomFormFields(resumableState: FZ.ResumableState | any, formAction: FZ.FormAction): FZ.CustomFormFields {
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
function pushStartSingletonElement(target: FZ.Chunk[], props: FZ.Props, tag: string | any | null, formatContext: FZ.FormatContext): FZ.ReactNode {
  target.push(startChunkForTag((tag as string)));
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
function pushStartGenericElement(target: FZ.Chunk[], props: FZ.Props, tag: string | any | null, formatContext: FZ.FormatContext): FZ.ReactNode {
  target.push(startChunkForTag((tag as string)));
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
    ? (target.push(escapeTextForBrowser((tag as string))), null)
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
function hoistPreambleState(renderState: FZ.RenderState | FZ.PreambleState, preambleState: FZ.PreambleState): void {
  renderState = (renderState as FZ.RenderState).preamble;
  null === (renderState as FZ.PreambleState).htmlChunks &&
    preambleState.htmlChunks &&
    ((renderState as FZ.PreambleState).htmlChunks = preambleState.htmlChunks);
  null === (renderState as FZ.PreambleState).headChunks &&
    preambleState.headChunks &&
    ((renderState as FZ.PreambleState).headChunks = preambleState.headChunks);
  null === (renderState as FZ.PreambleState).bodyChunks &&
    preambleState.bodyChunks &&
    ((renderState as FZ.PreambleState).bodyChunks = preambleState.bodyChunks);
}
function writeBootstrap(destination: FZ.Destination, renderState: FZ.RenderState | string[]): boolean {
  renderState = (renderState as FZ.RenderState).bootstrapChunks;
  for (var i: number | FZ.Chunk = 0; i < (renderState as string[]).length - 1; i++)
    writeChunk(destination, (renderState as string[])[i]!);
  return i < (renderState as string[]).length
    ? ((i = (renderState as string[])[i]!), ((renderState as string[]).length = 0), !!destination.write(i))
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
      writeChunk(this, hrefs[i]!), writeChunk(this, " ");
    writeChunk(this, hrefs[i]!);
    writeChunk(this, '">');
    for (i = 0; i < rules.length; i++) writeChunk(this, rules[i]!);
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
  for (var i = 0; i < resource.length; i++) writeChunk(this, resource[i]!);
  resource.length = 0;
}
var stylesheetFlushingQueue: FZ.Chunk[] = [];
function flushStyleInPreamble(this: FZ.Destination, stylesheet: FZ.StylesheetResource): void {
  pushLinkImpl(stylesheetFlushingQueue, stylesheet.props);
  for (var i = 0; i < stylesheetFlushingQueue.length; i++)
    writeChunk(this, stylesheetFlushingQueue[i]!);
  stylesheetFlushingQueue.length = 0;
  stylesheet.state = 2;
}
function flushStylesInPreamble(this: FZ.Destination, styleQueue: FZ.StyleQueue | number): void {
  var hasStylesheets = 0 < (styleQueue as FZ.StyleQueue).sheets.size;
  (styleQueue as FZ.StyleQueue).sheets.forEach(flushStyleInPreamble, this);
  (styleQueue as FZ.StyleQueue).sheets.clear();
  var rules = (styleQueue as FZ.StyleQueue).rules,
    hrefs = (styleQueue as FZ.StyleQueue).hrefs;
  if (!hasStylesheets || hrefs.length) {
    writeChunk(this, currentlyFlushingRenderState!.startInlineStyle);
    writeChunk(this, ' data-precedence="');
    writeChunk(this, (styleQueue as FZ.StyleQueue).precedence);
    styleQueue = 0;
    if (hrefs.length) {
      for (
        writeChunk(this, '" data-href="');
        styleQueue < hrefs.length - 1;
        styleQueue++
      )
        writeChunk(this, hrefs[styleQueue]!), writeChunk(this, " ");
      writeChunk(this, hrefs[styleQueue]!);
    }
    writeChunk(this, '">');
    for (styleQueue = 0; styleQueue < rules.length; styleQueue++)
      writeChunk(this, rules[styleQueue]!);
    writeChunk(this, "</style>");
    rules.length = 0;
    hrefs.length = 0;
  }
}
function preloadLateStyle(this: FZ.Destination, stylesheet: FZ.StylesheetResource | number): void {
  if (0 === (stylesheet as FZ.StylesheetResource).state) {
    (stylesheet as FZ.StylesheetResource).state = 1;
    var props = (stylesheet as FZ.StylesheetResource).props;
    pushLinkImpl(stylesheetFlushingQueue, {
      rel: "preload",
      as: "style",
      href: (stylesheet as FZ.StylesheetResource).props.href,
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
      writeChunk(this, stylesheetFlushingQueue[stylesheet]!);
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
  hoistableState.stylesheets.forEach(function (resource) {
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
        var precedence: any | string = resource.props["data-precedence"],
          props = resource.props,
          coercedHref = sanitizeURL("" + resource.props.href);
        writeChunk(
          destination,
          escapeJSObjectForInstructionScripts(coercedHref)
        );
        precedence = "" + precedence;
        writeChunk(destination, ",");
        writeChunk(
          destination,
          escapeJSObjectForInstructionScripts((precedence as string))
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
function prefetchDNS(href: FZ.PropValue): void {
  var request: FZ.Request | null = currentRequest ? currentRequest : null;
  if (request) {
    var resumableState: any | FZ.PreloadHeaders | null = request.resumableState,
      renderState = request.renderState;
    if ("string" === typeof href && href) {
      if (!resumableState.dnsResources.hasOwnProperty(href)) {
        resumableState.dnsResources[href] = null;
        resumableState = renderState.headers;
        var header: string | FZ.Resource | undefined, JSCompiler_temp: boolean | null;
        if (
          (JSCompiler_temp =
            (resumableState as FZ.PreloadHeaders | null) && 0 < (resumableState as FZ.PreloadHeaders | null)!.remainingCapacity)
        )
          JSCompiler_temp =
            ((header =
              "<" +
              ("" + href).replace(
                regexForHrefInLinkHeaderURLContext,
                escapeHrefForLinkHeaderURLContextReplacer
              ) +
              ">; rel=dns-prefetch"),
            0 <= ((resumableState as FZ.PreloadHeaders | null)!.remainingCapacity -= header.length + 2));
        JSCompiler_temp
          ? ((renderState.resets.dns[href] = null),
            (resumableState as FZ.PreloadHeaders | null)!.preconnects && ((resumableState as FZ.PreloadHeaders | null)!.preconnects += ", "),
            ((resumableState as FZ.PreloadHeaders | null)!.preconnects += (header as string | undefined)!))
          : ((header = []),
            pushLinkImpl(header, { href: href, rel: "dns-prefetch" }),
            renderState.preconnects.add(header));
      }
      enqueueFlush(request);
    }
  } else previousDispatcher.D(href);
}
function preconnect(href: FZ.PropValue, crossOrigin: FZ.PropValue): void {
  var request: FZ.Request | null = currentRequest ? currentRequest : null;
  if (request) {
    var resumableState: any | FZ.PreloadHeaders | null = request.resumableState,
      renderState = request.renderState;
    if ("string" === typeof href && href) {
      var bucket: FZ.ConnectBucket | FZ.Resource =
        "use-credentials" === crossOrigin
          ? "credentials"
          : "string" === typeof crossOrigin
            ? "anonymous"
            : "default";
      if (!resumableState.connectResources[bucket].hasOwnProperty(href)) {
        resumableState.connectResources[bucket][href] = null;
        resumableState = renderState.headers;
        var header: string | undefined, JSCompiler_temp: boolean | string | null;
        if (
          (JSCompiler_temp =
            (resumableState as FZ.PreloadHeaders | null) && 0 < (resumableState as FZ.PreloadHeaders | null)!.remainingCapacity)
        ) {
          JSCompiler_temp =
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
            JSCompiler_temp += '; crossorigin="' + escapedCrossOrigin + '"';
          }
          JSCompiler_temp =
            ((header = JSCompiler_temp),
            0 <= ((resumableState as FZ.PreloadHeaders | null)!.remainingCapacity -= header.length + 2));
        }
        JSCompiler_temp
          ? ((renderState.resets.connect[bucket]![href] = null),
            (resumableState as FZ.PreloadHeaders | null)!.preconnects && ((resumableState as FZ.PreloadHeaders | null)!.preconnects += ", "),
            ((resumableState as FZ.PreloadHeaders | null)!.preconnects += header!))
          : ((bucket = []),
            pushLinkImpl(bucket, {
              rel: "preconnect",
              href: href,
              crossOrigin: crossOrigin
            }),
            renderState.preconnects.add(bucket));
      }
      enqueueFlush(request);
    }
  } else previousDispatcher.C(href, crossOrigin);
}
function preload(href: FZ.PropValue | any, as: FZ.PropValue, options: FZ.Options): void {
  var request: FZ.Request | null = currentRequest ? currentRequest : null;
  if (request) {
    var resumableState: any | FZ.PreloadHeaders | FZ.Resource | null = request.resumableState,
      renderState = request.renderState;
    if (as && href) {
      switch (as) {
        case "image":
          if (options) {
            var imageSrcSet: any | FZ.Resource | FZ.ResourceDict = options.imageSrcSet;
            var imageSizes = options.imageSizes;
            var fetchPriority = options.fetchPriority;
          }
          var key: FZ.PropValue | string = imageSrcSet
            ? imageSrcSet + "\n" + (imageSizes || "")
            : href;
          if (resumableState.imageResources.hasOwnProperty(key)) return;
          resumableState.imageResources[key] = PRELOAD_NO_CREDS;
          resumableState = renderState.headers;
          var header: string;
          (resumableState as FZ.PreloadHeaders | null) &&
          0 < (resumableState as FZ.PreloadHeaders | null)!.remainingCapacity &&
          "string" !== typeof imageSrcSet &&
          "high" === fetchPriority &&
          ((header = getPreloadAsHeader(href, as, options)),
          0 <= ((resumableState as FZ.PreloadHeaders | null)!.remainingCapacity -= header.length + 2))
            ? ((renderState.resets.image[key] = PRELOAD_NO_CREDS),
              (resumableState as FZ.PreloadHeaders | null)!.highImagePreloads &&
                ((resumableState as FZ.PreloadHeaders | null)!.highImagePreloads += ", "),
              ((resumableState as FZ.PreloadHeaders | null)!.highImagePreloads += header))
            : ((resumableState = []),
              pushLinkImpl(
                (resumableState as FZ.Resource),
                assign(
                  { rel: "preload", href: imageSrcSet ? void 0 : href, as: as },
                  options
                )
              ),
              "high" === fetchPriority
                ? renderState.highImagePreloads.add((resumableState as FZ.Resource))
                : (renderState.bulkPreloads.add((resumableState as FZ.Resource)),
                  renderState.preloads.images.set(key, (resumableState as FZ.Resource))));
          break;
        case "style":
          if (resumableState.styleResources.hasOwnProperty(href)) return;
          imageSrcSet = [];
          pushLinkImpl(
            (imageSrcSet as FZ.Resource),
            assign({ rel: "preload", href: href, as: as }, options)
          );
          resumableState.styleResources[href] =
            !options ||
            ("string" !== typeof options.crossOrigin &&
              "string" !== typeof options.integrity)
              ? PRELOAD_NO_CREDS
              : [options.crossOrigin, options.integrity];
          renderState.preloads.stylesheets.set(href, (imageSrcSet as FZ.Resource));
          renderState.bulkPreloads.add((imageSrcSet as FZ.Resource));
          break;
        case "script":
          if (resumableState.scriptResources.hasOwnProperty(href)) return;
          imageSrcSet = [];
          renderState.preloads.scripts.set(href, (imageSrcSet as FZ.Resource));
          renderState.bulkPreloads.add((imageSrcSet as FZ.Resource));
          pushLinkImpl(
            (imageSrcSet as FZ.Resource),
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
              ((imageSrcSet = resumableState.unknownResources[as]),
              (imageSrcSet as FZ.ResourceDict).hasOwnProperty(href))
            )
              return;
          } else
            (imageSrcSet = {}),
              (resumableState.unknownResources[as] = (imageSrcSet as FZ.ResourceDict));
          (imageSrcSet as FZ.ResourceDict)[href] = PRELOAD_NO_CREDS;
          if (
            (resumableState = renderState.headers) &&
            0 < (resumableState as FZ.PreloadHeaders | null)!.remainingCapacity &&
            "font" === as &&
            ((key = getPreloadAsHeader(href, as, options)),
            0 <= ((resumableState as FZ.PreloadHeaders | null)!.remainingCapacity -= (key as string).length + 2))
          )
            (renderState.resets.font[href] = PRELOAD_NO_CREDS),
              (resumableState as FZ.PreloadHeaders | null)!.fontPreloads &&
                ((resumableState as FZ.PreloadHeaders | null)!.fontPreloads += ", "),
              ((resumableState as FZ.PreloadHeaders | null)!.fontPreloads += (key as string));
          else
            switch (
              ((resumableState = []),
              (href = assign({ rel: "preload", href: href, as: as }, options)),
              pushLinkImpl((resumableState as FZ.Resource), href),
              as)
            ) {
              case "font":
                renderState.fontPreloads.add((resumableState as FZ.Resource));
                break;
              default:
                renderState.bulkPreloads.add((resumableState as FZ.Resource));
            }
      }
      enqueueFlush(request);
    }
  } else previousDispatcher.L(href, as, options);
}
function preloadModule(href: FZ.PropValue, options: FZ.Options): void {
  var request: FZ.Request | null = currentRequest ? currentRequest : null;
  if (request) {
    var resumableState = request.resumableState,
      renderState = request.renderState;
    if (href) {
      var as: string | FZ.Resource =
        options && "string" === typeof options.as ? options.as : "script";
      switch (as) {
        case "script":
          if (resumableState.moduleScriptResources.hasOwnProperty(href)) return;
          as = [];
          resumableState.moduleScriptResources[href] =
            !options ||
            ("string" !== typeof options.crossOrigin &&
              "string" !== typeof options.integrity)
              ? PRELOAD_NO_CREDS
              : [options.crossOrigin, options.integrity];
          renderState.preloads.moduleScripts.set(href, as);
          break;
        default:
          if (resumableState.moduleUnknownResources.hasOwnProperty((as as string))) {
            var resources = resumableState.moduleUnknownResources[(as as string)];
            if (resources.hasOwnProperty(href)) return;
          } else
            (resources = {}),
              (resumableState.moduleUnknownResources[(as as string)] = resources);
          as = [];
          resources[href] = PRELOAD_NO_CREDS;
      }
      pushLinkImpl(as, assign({ rel: "modulepreload", href: href }, options));
      renderState.bulkPreloads.add(as);
      enqueueFlush(request);
    }
  } else previousDispatcher.m(href, options);
}
function preinitStyle(href: FZ.PropValue, precedence: FZ.PropValue | any, options: FZ.Options): void {
  var request: FZ.Request | null = currentRequest ? currentRequest : null;
  if (request) {
    var resumableState = request.resumableState,
      renderState: FZ.RenderState | FZ.Resource | undefined = request.renderState;
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
        } as FZ.StylesheetResource),
        resourceState &&
          (2 === resourceState.length &&
            adoptPreloadCredentials(precedence.props, resourceState),
          (renderState = renderState.preloads.stylesheets.get(href)) &&
          0 < renderState.length
            ? (renderState.length = 0)
            : (precedence.state = 1)),
        styleQueue.sheets.set(href, precedence),
        enqueueFlush(request));
    }
  } else previousDispatcher.S(href, precedence, options);
}
function preinitScript(src: FZ.PropValue | any, options: FZ.Options | any): void {
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
        (src = [] as FZ.Resource),
        renderState.scripts.add(src),
        pushScriptImpl(src, options),
        enqueueFlush(request));
    }
  } else previousDispatcher.X(src, options);
}
function preinitModuleScript(src: FZ.PropValue | any, options: FZ.Options | any): void {
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
        (src = [] as FZ.Resource),
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
function getPreloadAsHeader(href: FZ.PropValue | any, as: FZ.PropValue | any, params: FZ.Options): string {
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
function popToNearestCommonAncestor(prev: FZ.ContextNode | null, next: FZ.ContextNode): void {
  if (prev !== next) {
    prev!.context._currentValue = prev!.parentValue;
    prev = prev!.parent;
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
function popAllPrevious(prev: FZ.ContextNode | null): void {
  prev!.context._currentValue = prev!.parentValue;
  prev = prev!.parent;
  null !== prev && popAllPrevious(prev);
}
function pushAllNext(next: FZ.ContextNode): void {
  var parentNext = next.parent;
  null !== parentNext && pushAllNext(parentNext);
  next.context._currentValue = next.value;
}
function popPreviousToCommonLevel(prev: FZ.ContextNode | null, next: FZ.ContextNode): void {
  prev!.context._currentValue = prev!.parentValue;
  prev = prev!.parent;
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
function getTreeId(context: FZ.TreeContext | number): string {
  var overflow = (context as FZ.TreeContext).overflow;
  context = (context as FZ.TreeContext).id;
  return ((context as number) & ~(1 << (32 - clz32((context as number)) - 1))).toString(32) + overflow;
}
function pushTreeContext(baseContext: FZ.TreeContext | string, totalChildren: number, index: number): FZ.TreeContext {
  var baseIdWithLeadingBit: FZ.TreeId = (baseContext as FZ.TreeContext).id as FZ.TreeId;
  baseContext = (baseContext as FZ.TreeContext).overflow;
  var baseLength: number = (32 - clz32(baseIdWithLeadingBit) - 1) as number;
  baseIdWithLeadingBit &= ~(1 << baseLength);
  index += 1;
  var length: number | string = (32 - clz32(totalChildren) + baseLength) as number;
  if (30 < length) {
    var numberOfOverflowBits: number = (baseLength - (baseLength % 5)) as number;
    length = (
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
      overflow: length + baseContext
    };
  }
  return {
    id: (1 << length) | (index << baseLength) | baseIdWithLeadingBit,
    overflow: (baseContext as string)
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
function trackUsedThenable(thenableState: FZ.ThenableState | any, thenable: FZ.Thenable, index: number | any): FZ.FulfilledValue {
  index = (thenableState as FZ.ThenableState)[(index as number)];
  void 0 === index
    ? (thenableState as FZ.ThenableState).push(thenable)
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
function createRecoverableError(recoverable: FZ.Recoverable): Error {
  recoverable = recoverable._reason;
  if ("function" === typeof recoverable)
    try {
      var initializedReason: any | Error = recoverable();
    } catch ($jscomp$unused$catch) {
      initializedReason =
        "The reason for browser-only rendering could not be determined because its initializer threw.";
    }
  else initializedReason = recoverable;
  initializedReason = Error(
    "Browser-only rendering was requested by `browser()`.",
    void 0 === recoverable ? void 0 : { cause: initializedReason }
  );
  Object.defineProperty((initializedReason as Error), REACT_RECOVERABLE_TYPE, {
    value: !0
  });
  return (initializedReason as Error);
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
  } else (fatalRecoverableError as any).stack = void 0;
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
function useReducer(reducer: FZ.Reducer | FZ.UpdateQueue | any | FZ.Dispatch, initialArg: FZ.HookState | any, init?: ((initialArg: FZ.HookState) => FZ.HookState) | FZ.Update | ((initialArg: any) => any) | null | undefined): FZ.DispatchTuple {
  currentlyRenderingComponent = resolveCurrentlyRenderingComponent();
  workInProgressHook = createWorkInProgressHook();
  if (isReRender) {
    var queue: FZ.UpdateQueue | FZ.HookState = workInProgressHook.queue!;
    initialArg = (queue as FZ.UpdateQueue).dispatch;
    if (
      null !== renderPhaseUpdates &&
      ((init = renderPhaseUpdates.get((queue as FZ.UpdateQueue))), void 0 !== init)
    ) {
      renderPhaseUpdates.delete((queue as FZ.UpdateQueue));
      queue = workInProgressHook.memoizedState;
      do (queue = (reducer as FZ.Reducer)(queue, init.action)), (init = init.next);
      while (null !== init);
      workInProgressHook.memoizedState = queue;
      return [queue, initialArg];
    }
    return [workInProgressHook.memoizedState, initialArg];
  }
  reducer =
    (reducer as FZ.Reducer) === basicStateReducer
      ? "function" === typeof initialArg
        ? initialArg()
        : initialArg
      : void 0 !== (init as ((initialArg: any) => any) | undefined)
        ? (init as ((initialArg: FZ.HookState) => FZ.HookState))(initialArg)
        : initialArg;
  workInProgressHook.memoizedState = reducer;
  reducer = workInProgressHook.queue = { last: null, dispatch: null } as FZ.UpdateQueue;
  reducer = (reducer as FZ.UpdateQueue).dispatch = dispatchAction.bind(
    null,
    currentlyRenderingComponent,
    (reducer as FZ.UpdateQueue)
  );
  return [workInProgressHook.memoizedState, (reducer as FZ.Dispatch)];
}
function useMemo(nextCreate: (() => FZ.MemoValue) | any, deps: FZ.HookDeps): FZ.MemoValue {
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
  nextCreate = (nextCreate as (() => FZ.MemoValue))();
  workInProgressHook.memoizedState = [nextCreate, deps];
  return nextCreate;
}
function dispatchAction(componentIdentity: FZ.ComponentIdentity | FZ.Update, queue: FZ.UpdateQueue | FZ.Update, action: FZ.HookState | FZ.Update | any | undefined): void {
  if (25 <= numberOfReRenders)
    throw Error(
      "Too many re-renders. React limits the number of renders to prevent an infinite loop."
    );
  if (componentIdentity === currentlyRenderingComponent)
    if (
      ((didScheduleRenderPhaseUpdate = !0),
      (componentIdentity = { action: action, next: null } as FZ.Update),
      null === renderPhaseUpdates && (renderPhaseUpdates = new Map()),
      (action = renderPhaseUpdates.get((queue as FZ.UpdateQueue))),
      void 0 === (action as FZ.Update | undefined))
    )
      renderPhaseUpdates.set((queue as FZ.UpdateQueue), componentIdentity);
    else {
      for (queue = (action as FZ.Update | undefined)!; null !== (queue as FZ.Update).next; ) queue = (queue as FZ.Update).next!;
      (queue as FZ.Update).next = componentIdentity;
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
function useActionState(action: FZ.FormAction | FZ.ActionDispatch, initialState: FZ.HookState, permalink?: FZ.PropValue): FZ.ActionStateTuple {
  resolveCurrentlyRenderingComponent();
  var actionStateHookIndex: number = actionStateCounter++,
    request: FZ.Request | FZ.ReactFormState | null = currentlyRenderingRequest;
  if ("function" === typeof action.$$FORM_ACTION) {
    var nextPostbackStateKey: string | null = null,
      componentKeyPath = currentlyRenderingKeyPath;
    request = (request as FZ.Request | null)!.formState;
    var isSignatureEqual = action.$$IS_SIGNATURE_EQUAL;
    if (null !== request && "function" === typeof isSignatureEqual) {
      var postbackKey = request[1];
      isSignatureEqual.call(action, request[2], request[3]) &&
        ((nextPostbackStateKey =
          void 0 !== permalink
            ? "p" + permalink
            : "k" +
              Bun.hash(
                JSON.stringify([componentKeyPath, null, actionStateHookIndex])
              )),
        postbackKey === nextPostbackStateKey &&
          ((actionStateMatchingIndex = actionStateHookIndex as FZ.HookCounter),
          (initialState = request[0])));
    }
    var boundAction = action.bind(null, initialState);
    action = function (payload: any) {
      boundAction(payload);
    };
    "function" === typeof boundAction.$$FORM_ACTION &&
      ((action as FZ.ActionDispatch).$$FORM_ACTION = function (prefix) {
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
    return [initialState, (action as FZ.ActionDispatch), !1];
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
    useRef: function (initialValue: any | FZ.RefObject) {
      currentlyRenderingComponent = resolveCurrentlyRenderingComponent();
      workInProgressHook = createWorkInProgressHook();
      var previousRef = workInProgressHook.memoizedState;
      return null === previousRef
        ? ((initialValue = { current: initialValue }),
          (workInProgressHook.memoizedState = (initialValue as FZ.RefObject)))
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
      return makeId(resumableState, treeId, localId as number);
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
function describeNativeComponentFrame(fn: FZ.ElementType, construct: boolean): string {
  if (!fn || reentry) return "";
  reentry = !0;
  var previousPrepareStackTrace = (Error as any).prepareStackTrace;
  (Error as any).prepareStackTrace = void 0;
  try {
    var RunInRootFrame: FZ.RunInRootFrame | number = {
      DetermineComponentFrameRoot: function () {
        try {
          if (construct) {
            var Fake: (() => never) | boolean | FZ.ReactNode = function () {
              throw Error();
            };
            Object.defineProperty((Fake as (() => never)).prototype, "props", {
              set: function () {
                throw Error();
              }
            });
            if ("object" === typeof Reflect && Reflect.construct) {
              try {
                Reflect.construct((Fake as (() => never)), []);
              } catch (x: FZ.Thrown) {
                var control = x;
              }
              Reflect.construct(fn, [], (Fake as (() => never)));
            } else {
              try {
                ((Fake as (() => never)) as any).call();
              } catch (x$24: FZ.Thrown) {
                control = x$24;
              }
              Fake = !1;
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
                Fake = !0;
                new fn();
              } finally {
                (Fake as boolean) &&
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
            (Fake = fn()) &&
              "function" === typeof Fake.catch &&
              Fake.catch(function () {});
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
    var namePropDescriptor: PropertyDescriptor | number | undefined = Object.getOwnPropertyDescriptor(
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
        namePropDescriptor = RunInRootFrame = 0;
        RunInRootFrame < sampleLines.length &&
        !sampleLines[RunInRootFrame]!.includes("DetermineComponentFrameRoot");

      )
        RunInRootFrame++;
      for (
        ;
        namePropDescriptor < controlLines.length &&
        !controlLines[namePropDescriptor]!.includes(
          "DetermineComponentFrameRoot"
        );

      )
        namePropDescriptor++;
      if (
        RunInRootFrame === sampleLines.length ||
        namePropDescriptor === controlLines.length
      )
        for (
          RunInRootFrame = sampleLines.length - 1,
            namePropDescriptor = controlLines.length - 1;
          1 <= RunInRootFrame &&
          0 <= namePropDescriptor &&
          sampleLines[RunInRootFrame] !== controlLines[namePropDescriptor];

        )
          namePropDescriptor--;
      for (
        ;
        1 <= RunInRootFrame && 0 <= namePropDescriptor;
        RunInRootFrame--, namePropDescriptor--
      )
        if (sampleLines[RunInRootFrame] !== controlLines[namePropDescriptor]) {
          if (1 !== RunInRootFrame || 1 !== namePropDescriptor) {
            do
              if (
                (RunInRootFrame--,
                namePropDescriptor--,
                0 > namePropDescriptor ||
                  sampleLines[RunInRootFrame] !==
                    controlLines[namePropDescriptor])
              ) {
                var frame =
                  "\n" +
                  sampleLines[RunInRootFrame]!.replace(" at new ", " at ");
                fn.displayName &&
                  frame.includes("<anonymous>") &&
                  (frame = frame.replace("<anonymous>", fn.displayName));
                return frame;
              }
            while (1 <= RunInRootFrame && 0 <= namePropDescriptor);
          }
          break;
        }
    }
  } finally {
    (reentry = !1), ((Error as any).prepareStackTrace = previousPrepareStackTrace);
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
          ((type = (Error as any).prepareStackTrace),
          ((Error as any).prepareStackTrace = void 0),
          (location = location.stack),
          ((Error as any).prepareStackTrace = type),
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
  children: FZ.ReactNode | FZ.Task | any,
  resumableState: FZ.ResumableState | any,
  renderState: FZ.RenderState | FZ.Segment,
  rootFormatContext: FZ.FormatContext,
  progressiveChunkSize: number | undefined,
  onError: FZ.ErrorHandler | undefined,
  onBrowserBailout: FZ.BailoutHandler | undefined,
  onAllReady: (() => void) | undefined,
  onShellReady: (() => void) | undefined,
  onShellError: ((error: FZ.Thrown) => void) | undefined,
  onFatalError: ((error: FZ.Thrown) => void) | undefined,
  formState: FZ.ReactFormState
): FZ.Request {
  resumableState = new (RequestInstance as FZ.RequestConstructor)(
    resumableState,
    (renderState as FZ.RenderState),
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
  children = createRenderTask(
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
  pushComponentStack((children as FZ.Task));
  resumableState.pingedTasks.push((children as FZ.Task));
  return resumableState;
}
function createPrerenderRequest(
  children: FZ.ReactNode | any,
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
): FZ.Request {
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
  children: FZ.ReactNode | any,
  postponedState: FZ.PostponedStateGiven,
  renderState: FZ.RenderState | FZ.Request,
  onError: FZ.ErrorHandler | FZ.Segment | undefined,
  onBrowserBailout: FZ.BailoutHandler | undefined,
  onAllReady: (() => void) | undefined,
  onShellReady: (() => void) | undefined,
  onShellError: ((error: FZ.Thrown) => void) | undefined,
  onFatalError: ((error: FZ.Thrown) => void) | undefined
): FZ.Request {
  renderState = new (RequestInstance as FZ.RequestConstructor)(
    postponedState.resumableState,
    (renderState as FZ.RenderState),
    postponedState.rootFormatContext,
    postponedState.progressiveChunkSize,
    (onError as FZ.ErrorHandler | undefined),
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
    } as FZ.ReplaySet,
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
  children: FZ.ReactNode | any,
  postponedState: FZ.PostponedStateGiven,
  renderState: FZ.RenderState,
  onError: FZ.ErrorHandler | undefined,
  onBrowserBailout: FZ.BailoutHandler | undefined,
  onAllReady: (() => void) | undefined,
  onShellReady: (() => void) | undefined,
  onShellError: ((error: FZ.Thrown) => void) | undefined,
  onFatalError: ((error: FZ.Thrown) => void) | undefined
): FZ.Request {
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
  request: FZ.Request | FZ.HoistableState | null,
  row: FZ.SuspenseListRow | null,
  fallbackAbortableTasks: Set<FZ.Task> | FZ.SuspenseBoundary,
  preamble: FZ.BoundaryPreamble | FZ.SuspenseBoundary[] | null,
  defer: boolean
): FZ.SuspenseBoundary {
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
    preamble: (preamble as FZ.BoundaryPreamble | null),
    tracked: null
  } as FZ.SuspenseBoundary;
  null !== row &&
    (row.pendingTasks++,
    (preamble = row.boundaries),
    null !== preamble &&
      ((request as FZ.Request).allPendingTasks++,
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
function logRecoverableError(request: FZ.Request | FZ.BailoutHandler | FZ.ErrorHandler, error: FZ.Thrown, errorInfo: FZ.ThrownInfo): FZ.ErrorDigest {
  if (isRecoverableError(error))
    return (request = (request as FZ.Request).onBrowserBailout), (request as FZ.BailoutHandler)(error, errorInfo), "";
  request = (request as FZ.Request).onError;
  error = (request as FZ.ErrorHandler)(error, errorInfo);
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
        var unblockedBoundary = unblockedBoundaries[i]!;
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
      var rowBoundary = boundaries[i]!;
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
function renderSuspenseListRows(request: FZ.Request, task: FZ.Task, keyPath: FZ.KeyNode | any, rows: FZ.ReactNode, revealOrder: FZ.PropValue | any): void {
  var prevKeyPath = task.keyPath,
    prevTreeContext = task.treeContext,
    prevRow = task.row;
  task.keyPath = (keyPath as FZ.KeyNode);
  keyPath = rows.length;
  var previousSuspenseListRow: FZ.SuspenseListRow | null = null;
  if (null !== task.replay) {
    var resumeSlots: FZ.ResumeSlots | FZ.ReactNode | FZ.Segment | number = task.replay.slots;
    if (null !== (resumeSlots as FZ.ResumeSlots) && "object" === typeof (resumeSlots as FZ.ResumeSlots))
      for (var n = 0; n < keyPath; n++) {
        var i: any | FZ.ReactNode | number =
            "backwards" !== revealOrder &&
            "unstable_legacy-backwards" !== revealOrder
              ? n
              : keyPath - 1 - n,
          node: any | number = rows[i];
        task.row = previousSuspenseListRow = createSuspenseListRow(
          previousSuspenseListRow
        );
        task.treeContext = pushTreeContext(prevTreeContext, keyPath as number, i);
        var resumeSegmentID: FZ.SegmentId | undefined = (resumeSlots as FZ.SlotMap)[i];
        "number" === typeof resumeSegmentID
          ? (resumeNode(request, task, resumeSegmentID as FZ.SegmentId, node, i as FZ.ChildIndex),
            delete (resumeSlots as FZ.SlotMap)[i])
          : renderNode(request, task, node, i as FZ.ChildIndex);
        0 === --previousSuspenseListRow.pendingTasks &&
          finishSuspenseListRow(request, previousSuspenseListRow);
      }
    else
      for (resumeSlots = 0; (resumeSlots as number) < keyPath; resumeSlots++)
        (n =
          "backwards" !== revealOrder &&
          "unstable_legacy-backwards" !== revealOrder
            ? (resumeSlots as number)
            : keyPath - 1 - (resumeSlots as number)),
          (i = rows[n]),
          (task.row = previousSuspenseListRow =
            createSuspenseListRow(previousSuspenseListRow)),
          (task.treeContext = pushTreeContext(prevTreeContext, keyPath as number, n)),
          renderNode(request, task, (i as FZ.ReactNode), n as FZ.ChildIndex),
          0 === --previousSuspenseListRow.pendingTasks &&
            finishSuspenseListRow(request, previousSuspenseListRow);
  } else if (
    "backwards" !== revealOrder &&
    "unstable_legacy-backwards" !== revealOrder
  )
    for (revealOrder = 0; revealOrder < keyPath; revealOrder++)
      (resumeSlots = rows[revealOrder]),
        (task.row = previousSuspenseListRow =
          createSuspenseListRow(previousSuspenseListRow)),
        (task.treeContext = pushTreeContext(
          prevTreeContext,
          keyPath as number,
          revealOrder
        )),
        renderNode(request, task, resumeSlots, revealOrder as FZ.ChildIndex),
        0 === --previousSuspenseListRow.pendingTasks &&
          finishSuspenseListRow(request, previousSuspenseListRow);
  else {
    resumeSlots = task.blockedSegment!;
    n = (resumeSlots as FZ.Segment).children.length;
    i = (resumeSlots as FZ.Segment).chunks.length;
    for (node = 0; (node as number) < keyPath; node++) {
      resumeSegmentID =
        "unstable_legacy-backwards" === revealOrder ? keyPath - 1 - (node as number) : (node as number);
      var node$40 = rows[resumeSegmentID];
      task.row = previousSuspenseListRow = createSuspenseListRow(
        previousSuspenseListRow
      );
      task.treeContext = pushTreeContext(
        prevTreeContext,
        keyPath as number,
        resumeSegmentID
      );
      var newSegment = createPendingSegment(
        request,
        i as FZ.ChunkIndex,
        null,
        task.formatContext,
        0 === resumeSegmentID ? (resumeSlots as FZ.Segment).lastPushedText : !0,
        !0
      );
      (resumeSlots as FZ.Segment).children.splice(n, 0, newSegment);
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
    task.blockedSegment = (resumeSlots as FZ.Segment);
    (resumeSlots as FZ.Segment).lastPushedText = !1;
  }
  null !== prevRow &&
    null !== previousSuspenseListRow &&
    0 < previousSuspenseListRow.pendingTasks &&
    (prevRow.pendingTasks++, (previousSuspenseListRow.next = prevRow));
  task.treeContext = prevTreeContext;
  task.row = prevRow;
  task.keyPath = prevKeyPath;
}
function renderWithHooks(request: FZ.Request | any, task: FZ.Task, keyPath: FZ.KeyNode, Component: FZ.FunctionComponent, props: FZ.Props, secondArg: FZ.Ref): FZ.ReactNode {
  var prevThenableState = task.thenableState;
  task.thenableState = null;
  currentlyRenderingComponent = {};
  currentlyRenderingTask = task;
  currentlyRenderingRequest = (request as FZ.Request);
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
  keyPath: FZ.KeyNode | FZ.TreeContext,
  children: FZ.ReactNode,
  hasId: boolean,
  actionStateCount: FZ.HookCounter | FZ.KeyNode | null,
  actionStateMatchingIndex: FZ.HookCounter
): void {
  var didEmitActionStateMarkers = !1;
  if (0 !== actionStateCount && null !== request.formState) {
    var segment: FZ.Segment | FZ.Chunk[] | null = task.blockedSegment;
    if (null !== segment) {
      didEmitActionStateMarkers = !0;
      segment = segment.chunks;
      for (var i = 0; i < (actionStateCount as FZ.HookCounter); i++)
        i === actionStateMatchingIndex
          ? segment.push("\x3c!--F!--\x3e")
          : segment.push("\x3c!--F--\x3e");
    }
  }
  actionStateCount = task.keyPath;
  task.keyPath = (keyPath as FZ.KeyNode);
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
                  } as FZ.BoundaryPreamble
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
function renderNodeDestructive(request: FZ.Request, task: FZ.Task, node: FZ.ReactNode | any, childIndex: FZ.ChildIndex): void {
  null !== task.replay && "number" === typeof task.replay.slots
    ? resumeNode(request, task, task.replay.slots as FZ.SegmentId, node, childIndex)
    : ((task.node = node),
      (task.childIndex = childIndex),
      (node = task.componentStack),
      pushComponentStack(task),
      retryNode(request, task),
      (task.componentStack = node));
}
function retryNode(request: FZ.Request | FZ.Thrown, task: FZ.Task): void {
  var node: any | number = task.node,
    childIndex: any | FZ.ReplayNode[] | string | FZ.Segment | number | null = task.childIndex;
  if (null !== node) {
    if ("object" === typeof node) {
      switch (node.$$typeof) {
        case REACT_ELEMENT_TYPE:
          var type: FZ.ElementType | FZ.ReplayNode[] = node.type,
            key: FZ.KeyOrIndex | FZ.KeyNode | FZ.ThrownInfo | FZ.ErrorDigest = node.key,
            props: FZ.Props | FZ.SuspenseBoundary | null = node.props;
          node = props.ref;
          var ref: FZ.Ref | FZ.ResumeSlots = void 0 !== node ? node : null,
            name: FZ.ComponentName | FZ.ReplayNode[] = getComponentNameFromType(type),
            keyOrIndex: FZ.KeyOrIndex | FZ.KeyNode | null =
              null == key || key === REACT_OPTIMISTIC_KEY
                ? -1 === childIndex
                  ? 0
                  : childIndex
                : key;
          key = [task.keyPath, name, keyOrIndex];
          if (null !== task.replay)
            a: {
              var replay: FZ.ReplaySet | FZ.SegmentId = task.replay;
              childIndex = replay.nodes;
              for (node = 0; (node as number) < (childIndex as FZ.ReplayNode[]).length; node++) {
                var node$jscomp$0: FZ.ReplayNode | FZ.ResumeSlots = (childIndex as FZ.ReplayNode[])[(node as number)]!;
                if (keyOrIndex === node$jscomp$0[1]!) {
                  if (4 === node$jscomp$0.length) {
                    if (null !== name && name !== node$jscomp$0[0]!)
                      throw Error(
                        "Expected the resume to render <" +
                          node$jscomp$0[0]! +
                          "> in this slot but instead it rendered <" +
                          name +
                          ">. The tree doesn't match so React will fallback to client rendering."
                      );
                    var childNodes: FZ.ReplayNode[] | FZ.Thrown | FZ.Task | FZ.GivenFunction | FZ.IteratorFn = node$jscomp$0[2]!,
                      childSlots: FZ.ResumeSlots | FZ.ThrownInfo | FZ.ReactNode[] = node$jscomp$0[3]!,
                      currentNode: FZ.ReactNode | FZ.Request | FZ.ErrorDigest = task.node;
                    task.replay = {
                      nodes: (childNodes as FZ.ReplayNode[]),
                      slots: (childSlots as FZ.ResumeSlots),
                      pendingTasks: 1
                    };
                    try {
                      renderElement((request as FZ.Request), task, (key as FZ.KeyNode), type, props, ref);
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
                            : (childIndex as FZ.ReplayNode[]).splice((node as number), 1),
                          x)
                        );
                      task.replay.pendingTasks--;
                      key = getThrownInfo(task.componentStack);
                      currentNode = (request as FZ.Request);
                      props = task.blockedBoundary;
                      request = (request as FZ.Request).aborted ? (request as FZ.Request).fatalError : x;
                      key = logRecoverableError((currentNode as FZ.Request), request, (key as FZ.ThrownInfo));
                      abortRemainingReplayNodes(
                        (currentNode as FZ.Request),
                        (props as FZ.SuspenseBoundary | null),
                        (childNodes as FZ.ReplayNode[]),
                        (childSlots as FZ.ResumeSlots),
                        request,
                        (key as FZ.ErrorDigest)
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
                      replay = (node$jscomp$0[5]!) as FZ.SegmentId;
                      type = node$jscomp$0[2]!;
                      ref = node$jscomp$0[3]!;
                      name =
                        null === node$jscomp$0[4]! ? [] : node$jscomp$0[4]![2]!;
                      node$jscomp$0 =
                        null === node$jscomp$0[4]! ? null : node$jscomp$0[4]![3]!;
                      keyOrIndex = task.keyPath;
                      var prevContext = task.formatContext,
                        prevRow = task.row,
                        previousReplaySet = task.replay,
                        parentBoundary = task.blockedBoundary,
                        parentHoistableState = task.hoistableState,
                        content: FZ.ReactNode = props.children;
                      props = props.fallback;
                      var fallbackAbortSet = new Set<FZ.Task>(),
                        resumedBoundary = createSuspenseBoundary(
                          (request as FZ.Request),
                          task.row,
                          fallbackAbortSet,
                          2 > task.formatContext.insertionMode
                            ? {
                                content: createPreambleState(),
                                fallback: createPreambleState()
                              } as FZ.BoundaryPreamble
                            : null,
                          !1
                        );
                      resumedBoundary.parentFlushed = !0;
                      resumedBoundary.rootSegmentID = replay;
                      task.blockedBoundary = resumedBoundary;
                      task.hoistableState = resumedBoundary.contentState;
                      task.keyPath = (key as FZ.KeyNode);
                      task.formatContext = getSuspenseContentFormatContext(
                        (request as FZ.Request).resumableState,
                        prevContext
                      );
                      task.row = null;
                      task.replay = {
                        nodes: (type as FZ.ReplayNode[]),
                        slots: (ref as FZ.ResumeSlots),
                        pendingTasks: 1
                      };
                      try {
                        renderNode((request as FZ.Request), task, content, -1);
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
                          (request as FZ.Request).completedBoundaries.push(resumedBoundary);
                          break b;
                        }
                      } catch (thrownValue: FZ.Thrown) {
                        (resumedBoundary.status = 4),
                          (childNodes = (request as FZ.Request).aborted
                            ? (request as FZ.Request).fatalError
                            : thrownValue),
                          (childSlots = getThrownInfo(task.componentStack)),
                          (currentNode = logRecoverableError(
                            (request as FZ.Request),
                            childNodes,
                            childSlots
                          )),
                          (resumedBoundary.errorDigest = (currentNode as FZ.ErrorDigest)),
                          task.replay.pendingTasks--,
                          (request as FZ.Request).clientRenderedBoundaries.push(
                            resumedBoundary
                          );
                      } finally {
                        (task.blockedBoundary = parentBoundary),
                          (task.hoistableState = parentHoistableState),
                          (task.replay = previousReplaySet),
                          (task.keyPath = (keyOrIndex as FZ.KeyNode | null)),
                          (task.formatContext = prevContext),
                          (task.row = prevRow);
                      }
                      childNodes = createReplayTask(
                        (request as FZ.Request),
                        null,
                        { nodes: (name as FZ.ReplayNode[]), slots: node$jscomp$0, pendingTasks: 0 } as FZ.ReplaySet,
                        props,
                        -1,
                        parentBoundary,
                        resumedBoundary.fallbackState,
                        fallbackAbortSet,
                        [(key as FZ.KeyNode)[0], "Suspense Fallback", (key as FZ.KeyNode)[2]],
                        getSuspenseFallbackFormatContext(
                          (request as FZ.Request).resumableState,
                          task.formatContext
                        ),
                        task.context,
                        task.treeContext,
                        task.row,
                        replaceSuspenseComponentStackWithSuspenseFallbackStack(
                          task.componentStack
                        )
                      );
                      pushComponentStack((childNodes as FZ.Task));
                      (request as FZ.Request).pingedTasks.push((childNodes as FZ.Task));
                    }
                  }
                  (childIndex as FZ.ReplayNode[]).splice((node as number), 1);
                  break a;
                }
              }
            }
          else renderElement((request as FZ.Request), task, (key as FZ.KeyNode), type, props, ref);
          return;
        case REACT_PORTAL_TYPE:
          throw Error(
            "Portals are not currently supported by the server renderer. Render them conditionally so that they only appear on the client render."
          );
        case REACT_LAZY_TYPE:
          childNodes = node._init;
          node = childNodes(node._payload);
          if ((request as FZ.Request).aborted) throw null;
          renderNodeDestructive((request as FZ.Request), task, node, childIndex);
          return;
      }
      if (isArrayImpl(node)) {
        renderChildrenArray((request as FZ.Request), task, node, childIndex);
        return;
      }
      if ((childNodes = getIteratorFn(node)))
        if ((childNodes = childNodes.call(node))) {
          node = childNodes.next();
          if (!node.done) {
            childSlots = [];
            do childSlots.push(node.value), (node = childNodes.next());
            while (!node.done);
            renderChildrenArray((request as FZ.Request), task, childSlots, childIndex);
          }
          return;
        }
      if ("function" === typeof node.then)
        return (
          (task.thenableState = null),
          renderNodeDestructive((request as FZ.Request), task, unwrapThenable(node), childIndex)
        );
      if (node.$$typeof === REACT_CONTEXT_TYPE)
        return renderNodeDestructive(
          (request as FZ.Request),
          task,
          node._currentValue,
          childIndex
        );
      childIndex = Object.prototype.toString.call(node);
      throw Error(
        "Objects are not valid as a React child (found: " +
          ("[object Object]" === (childIndex as string)
            ? "object with keys {" + Object.keys(node).join(", ") + "}"
            : (childIndex as string)) +
          "). If you meant to render a collection of children, use an array instead."
      );
    }
    if ("string" === typeof node)
      (childIndex = task.blockedSegment),
        null !== (childIndex as FZ.Segment | null) &&
          ((childIndex as FZ.Segment | null)!.lastPushedText = pushTextInstance(
            (childIndex as FZ.Segment | null)!.chunks,
            node,
            (request as FZ.Request).renderState,
            (childIndex as FZ.Segment | null)!.lastPushedText
          ));
    else if ("number" === typeof node || "bigint" === typeof node)
      (childIndex = task.blockedSegment),
        null !== (childIndex as FZ.Segment | null) &&
          ((childIndex as FZ.Segment | null)!.lastPushedText = pushTextInstance(
            (childIndex as FZ.Segment | null)!.chunks,
            "" + node,
            (request as FZ.Request).renderState,
            (childIndex as FZ.Segment | null)!.lastPushedText
          ));
  }
}
function renderChildrenArray(request: FZ.Request | FZ.Thrown, task: FZ.Task, children: FZ.ReactNode[] | FZ.Request, childIndex: FZ.ChildIndex | FZ.ReplayNode[] | any): void {
  var prevKeyPath = task.keyPath;
  if (
    -1 !== (childIndex as FZ.ChildIndex) &&
    ((task.keyPath = [task.keyPath, "Fragment", (childIndex as FZ.ChildIndex)]),
    null !== task.replay)
  ) {
    for (
      var replay: FZ.ReplaySet | FZ.TreeContext = task.replay, replayNodes: FZ.ReplayNode[] | number = replay.nodes, j: number | FZ.ResumeSlots = 0;
      j < replayNodes.length;
      j++
    ) {
      var node: FZ.ReplayNode | FZ.ResumeSlots | FZ.ReactNode = replayNodes[j];
      if ((node as FZ.ReplayNode)[1] === (childIndex as FZ.ChildIndex)) {
        childIndex = (node as FZ.ReplayNode)[2];
        node = (node as FZ.ReplayNode)[3];
        task.replay = { nodes: (childIndex as FZ.ReplayNode[]), slots: (node as FZ.ResumeSlots), pendingTasks: 1 };
        try {
          renderChildrenArray((request as FZ.Request), task, (children as FZ.ReactNode[]), -1);
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
          var thrownInfo: FZ.ThrownInfo | FZ.ErrorDigest = getThrownInfo(task.componentStack);
          children = (request as FZ.Request);
          var boundary: FZ.SuspenseBoundary | FZ.SegmentId | null | undefined = task.blockedBoundary;
          request = (request as FZ.Request).aborted ? (request as FZ.Request).fatalError : x;
          thrownInfo = logRecoverableError(children, request, thrownInfo);
          abortRemainingReplayNodes(
            children,
            boundary,
            (childIndex as FZ.ReplayNode[]),
            (node as FZ.ResumeSlots),
            request,
            thrownInfo
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
  replay = task.treeContext;
  replayNodes = (children as FZ.ReactNode[]).length as number;
  if (
    null !== task.replay &&
    ((j = task.replay.slots), null !== j && "object" === typeof j)
  ) {
    for (childIndex = 0; (childIndex as FZ.ChildIndex) < replayNodes; childIndex++)
      (node = (children as FZ.ReactNode[])[(childIndex as FZ.ChildIndex)]),
        (task.treeContext = pushTreeContext(replay, replayNodes, (childIndex as FZ.ChildIndex))),
        (boundary = (j as FZ.SlotMap)[childIndex]),
        "number" === typeof boundary
          ? (resumeNode((request as FZ.Request), task, boundary as FZ.SegmentId, node, (childIndex as FZ.ChildIndex) as FZ.ChildIndex),
            delete (j as FZ.SlotMap)[childIndex])
          : renderNode((request as FZ.Request), task, node, (childIndex as FZ.ChildIndex) as FZ.ChildIndex);
    task.treeContext = replay;
    task.keyPath = prevKeyPath;
    return;
  }
  for (j = 0; j < replayNodes; j++)
    (childIndex = (children as FZ.ReactNode[])[j]),
      (task.treeContext = pushTreeContext(replay, replayNodes, j)),
      renderNode((request as FZ.Request), task, childIndex, j as FZ.ChildIndex);
  task.treeContext = replay;
  task.keyPath = prevKeyPath;
}
function trackPostponedBoundary(request: FZ.Request | FZ.KeyNode | null, trackedPostpones: FZ.PostponedHoles, boundary: FZ.SuspenseBoundary | FZ.ReplayNode): FZ.ReplayNode {
  (boundary as FZ.SuspenseBoundary).status = 5;
  (boundary as FZ.SuspenseBoundary).rootSegmentID = (request as FZ.Request).nextSegmentId++;
  var tracked: FZ.TrackedBoundary | FZ.ReplayNode | null = (boundary as FZ.SuspenseBoundary).tracked;
  if (null === tracked)
    throw Error(
      "It should not be possible to postpone at the root. This is a bug in React."
    );
  request = (tracked as FZ.TrackedBoundary | null)!.contentKeyPath;
  if (null === request)
    throw Error(
      "It should not be possible to postpone at the root. This is a bug in React."
    );
  tracked = (tracked as FZ.TrackedBoundary | null)!.fallbackNode;
  var children: FZ.ReplayNode[] = [],
    boundaryNode = trackedPostpones.workingMap.get((request as FZ.KeyNode));
  if (void 0 === boundaryNode)
    return (
      (boundary = [
        (request as FZ.KeyNode)[1],
        (request as FZ.KeyNode)[2],
        children,
        null,
        tracked,
        (boundary as FZ.SuspenseBoundary).rootSegmentID
      ] as FZ.ReplayNode),
      trackedPostpones.workingMap.set((request as FZ.KeyNode), boundary),
      addToReplayParent(boundary, (request as FZ.KeyNode)[0], trackedPostpones),
      boundary
    );
  boundaryNode[4] = (tracked as FZ.ReplayNode | null);
  boundaryNode[5] = (boundary as FZ.SuspenseBoundary).rootSegmentID;
  return boundaryNode;
}
function trackPostpone(request: FZ.Request | FZ.ResumeSlots | FZ.SlotMap | number, trackedPostpones: FZ.PostponedHoles, task: FZ.Task | FZ.ReplayNode | undefined, segment: FZ.Segment): void {
  segment.status = 5;
  var keyPath = (task as FZ.Task).keyPath,
    boundary: FZ.SuspenseBoundary | Map<FZ.KeyNode, FZ.ReplayNode> | null = (task as FZ.Task).blockedBoundary;
  if (null === boundary)
    (segment.id = (request as FZ.Request).nextSegmentId++),
      (trackedPostpones.rootSlots = segment.id),
      null !== (request as FZ.Request).completedRootSegment &&
        ((request as FZ.Request).completedRootSegment!.status = 5);
  else {
    if (null !== boundary && 0 === (boundary as FZ.SuspenseBoundary | null)!.status) {
      var boundaryNode: FZ.ReplayNode | undefined = trackPostponedBoundary(
        (request as FZ.Request),
        trackedPostpones,
        boundary
      );
      if (
        null !== (boundary as FZ.SuspenseBoundary | null)!.tracked &&
        (boundary as FZ.SuspenseBoundary | null)!.tracked!.contentKeyPath === keyPath &&
        -1 === (task as FZ.Task).childIndex
      ) {
        -1 === segment.id &&
          (segment.id = segment.parentFlushed
            ? (boundary as FZ.SuspenseBoundary | null)!.rootSegmentID
            : (request as FZ.Request).nextSegmentId++);
        boundaryNode[3] = segment.id;
        return;
      }
    }
    -1 === segment.id &&
      (segment.id =
        segment.parentFlushed && null !== boundary
          ? (boundary as FZ.SuspenseBoundary | null)!.rootSegmentID
          : (request as FZ.Request).nextSegmentId++);
    if (-1 === (task as FZ.Task).childIndex)
      null === keyPath
        ? (trackedPostpones.rootSlots = segment.id)
        : ((task = trackedPostpones.workingMap.get(keyPath)),
          void 0 === task
            ? ((task = [keyPath[1], keyPath[2], [], segment.id] as FZ.ReplayNode),
              addToReplayParent(task, keyPath[0], trackedPostpones))
            : (task[3] = segment.id));
    else {
      if (null === keyPath)
        if (((request = trackedPostpones.rootSlots), null === request))
          request = trackedPostpones.rootSlots = {} as FZ.SlotMap;
        else {
          if ("number" === typeof request)
            throw Error(
              "It should not be possible to postpone both at the root of an element as well as a slot below. This is a bug in React."
            );
        }
      else if (
        ((boundary = trackedPostpones.workingMap),
        (boundaryNode = boundary.get(keyPath)),
        void 0 === boundaryNode)
      )
        (request = {} as FZ.SlotMap),
          (boundaryNode = [keyPath[1], keyPath[2], [], request]),
          boundary.set(keyPath, boundaryNode),
          addToReplayParent(boundaryNode, keyPath[0], trackedPostpones);
      else if (((request = boundaryNode[3]), null === request))
        request = boundaryNode[3] = {} as FZ.SlotMap;
      else if ("number" === typeof request)
        throw Error(
          "It should not be possible to postpone both at the root of an element as well as a slot below. This is a bug in React."
        );
      request[(task as FZ.Task).childIndex] = segment.id;
    }
  }
}
function untrackBoundary(request: FZ.Request | FZ.PostponedHoles | FZ.ReplayNode | null | undefined, boundary: FZ.SuspenseBoundary | FZ.TrackedBoundary | FZ.KeyNode | null): void {
  request = (request as FZ.Request).trackedPostpones;
  null !== request &&
    ((boundary = (boundary as FZ.SuspenseBoundary).tracked),
    null !== boundary &&
      ((boundary = (boundary as FZ.TrackedBoundary).contentKeyPath),
      null !== boundary &&
        ((request = (request as FZ.PostponedHoles).workingMap.get(boundary)),
        void 0 !== request &&
          (((request as FZ.ReplayNode).length = 4), ((request as FZ.ReplayNode)[2] = []), ((request as FZ.ReplayNode)[3] = null)))));
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
function renderNode(request: FZ.Request | FZ.Ping, task: FZ.Task, node: FZ.ReactNode | any, childIndex: FZ.ChildIndex | FZ.ThenableState | null): void {
  var previousFormatContext = task.formatContext,
    previousContext = task.context,
    previousKeyPath = task.keyPath,
    previousTreeContext = task.treeContext,
    previousComponentStack = task.componentStack,
    segment: FZ.Segment | FZ.ReplaySet | FZ.Thenable | FZ.ThenableState | FZ.Task | null = task.blockedSegment;
  if (null === (segment as FZ.Segment | null)) {
    segment = task.replay;
    try {
      return renderNodeDestructive((request as FZ.Request), task, node, childIndex as FZ.ChildIndex);
    } catch (thrownValue: FZ.Thrown) {
      if (
        (resetHooksState(),
        (node =
          thrownValue === SuspenseException
            ? getSuspendedThenable()
            : thrownValue),
        !(request as FZ.Request).aborted && "object" === typeof node && null !== node)
      ) {
        if ("function" === typeof node.then) {
          childIndex =
            thrownValue === SuspenseException
              ? getThenableStateAfterSuspending()
              : null;
          request = spawnNewSuspendedReplayTask((request as FZ.Request), task, childIndex).ping;
          node.then(request.resolve, request.reject);
          task.formatContext = previousFormatContext;
          task.context = previousContext;
          task.keyPath = previousKeyPath;
          task.treeContext = previousTreeContext;
          task.componentStack = previousComponentStack;
          task.replay = (segment as FZ.ReplaySet | null);
          switchContext(previousContext);
          return;
        }
        if ("Maximum call stack size exceeded" === node.message) {
          node =
            thrownValue === SuspenseException
              ? getThenableStateAfterSuspending()
              : null;
          node = spawnNewSuspendedReplayTask((request as FZ.Request), task, node);
          (request as FZ.Request).pingedTasks.push(node);
          task.formatContext = previousFormatContext;
          task.context = previousContext;
          task.keyPath = previousKeyPath;
          task.treeContext = previousTreeContext;
          task.componentStack = previousComponentStack;
          task.replay = (segment as FZ.ReplaySet | null);
          switchContext(previousContext);
          return;
        }
      }
    }
  } else {
    var childrenLength = (segment as FZ.Segment | null)!.children.length,
      chunkLength = (segment as FZ.Segment | null)!.chunks.length;
    try {
      return renderNodeDestructive((request as FZ.Request), task, node, (childIndex as FZ.ChildIndex) as FZ.ChildIndex);
    } catch (thrownValue$64: FZ.Thrown) {
      if (
        (resetHooksState(),
        ((segment as FZ.Segment | null)!.children.length = childrenLength),
        ((segment as FZ.Segment | null)!.chunks.length = chunkLength),
        (node =
          thrownValue$64 === SuspenseException
            ? getSuspendedThenable()
            : thrownValue$64),
        !(request as FZ.Request).aborted && "object" === typeof node && null !== node)
      ) {
        if ("function" === typeof node.then) {
          segment = node;
          node =
            thrownValue$64 === SuspenseException
              ? getThenableStateAfterSuspending()
              : null;
          request = spawnNewSuspendedRenderTask((request as FZ.Request), task, node).ping;
          segment.then(request.resolve, request.reject);
          task.formatContext = previousFormatContext;
          task.context = previousContext;
          task.keyPath = previousKeyPath;
          task.treeContext = previousTreeContext;
          task.componentStack = previousComponentStack;
          switchContext(previousContext);
          return;
        }
        if ("Maximum call stack size exceeded" === node.message) {
          segment =
            thrownValue$64 === SuspenseException
              ? getThenableStateAfterSuspending()
              : null;
          segment = spawnNewSuspendedRenderTask((request as FZ.Request), task, (segment as FZ.ThenableState | null));
          (request as FZ.Request).pingedTasks.push((segment as FZ.Task));
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
    var node: FZ.ReplayNode | FZ.SegmentId = nodes[i]!;
    if (4 === node.length)
      abortRemainingReplayNodes(
        request$jscomp$0,
        boundary,
        node[2]!,
        node[3]!,
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
function abortTask(task: FZ.Task | FZ.Segment | null, request: FZ.Request): void {
  if (task !== request.currentTask) {
    var boundary = (task as FZ.Task).blockedBoundary;
    task = (task as FZ.Task).blockedSegment;
    null !== task && ((task as FZ.Segment).status = 3);
    null !== boundary &&
      boundary.fallbackAbortableTasks.forEach(function (fallbackTask) {
        return abortTask(fallbackTask, request);
      });
  }
}
function finishAbortedTask(task: FZ.Task | FZ.SuspenseListRow | Error | null, request: FZ.Request, error: FZ.Thrown): void {
  if (task !== request.currentTask) {
    var boundary: FZ.SuspenseBoundary | FZ.ReplaySet | FZ.PostponedHoles | null = (task as FZ.Task).blockedBoundary,
      segment = (task as FZ.Task).blockedSegment;
    if (null === segment || 3 === segment.status) {
      var errorInfo: FZ.ThrownInfo | FZ.ErrorDigest | FZ.SuspenseListRow | null = getThrownInfo((task as FZ.Task).componentStack),
        isRecoverableReason = isRecoverableError(error);
      if (null === boundary) {
        boundary = (task as FZ.Task).replay;
        if (null === boundary) {
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
            : ((boundary = request.trackedPostpones),
              logRecoverableError(request, error, errorInfo),
              trackPostpone(request, boundary, (task as FZ.Task), segment),
              finishedTask(request, null, (task as FZ.Task).row, segment));
          return;
        }
        12 !== request.status &&
          13 !== request.status &&
          ((boundary as FZ.ReplaySet | null)!.pendingTasks--,
          0 === (boundary as FZ.ReplaySet | null)!.pendingTasks &&
            0 < (boundary as FZ.ReplaySet | null)!.nodes.length &&
            ((errorInfo = logRecoverableError(request, error, errorInfo)),
            abortRemainingReplayNodes(
              request,
              null,
              (boundary as FZ.ReplaySet | null)!.nodes,
              (boundary as FZ.ReplaySet | null)!.slots,
              error,
              errorInfo
            )),
          request.pendingRootTasks--,
          0 === request.pendingRootTasks && completeShell(request));
      } else {
        var trackedPostpones$65 = request.trackedPostpones;
        if (4 !== (boundary as FZ.SuspenseBoundary | null)!.status) {
          if (
            !isRecoverableReason &&
            null !== trackedPostpones$65 &&
            null !== segment
          )
            return (
              logRecoverableError(request, error, errorInfo),
              trackPostpone(request, trackedPostpones$65, (task as FZ.Task), segment),
              (boundary as FZ.SuspenseBoundary | null)!.fallbackAbortableTasks.forEach(function (fallbackTask) {
                return finishAbortedTask(fallbackTask, request, error);
              }),
              (boundary as FZ.SuspenseBoundary | null)!.fallbackAbortableTasks.clear(),
              finishedTask(request, (boundary as FZ.SuspenseBoundary | null), (task as FZ.Task).row, segment)
            );
          (boundary as FZ.SuspenseBoundary | null)!.status = 4;
          errorInfo = logRecoverableError(request, error, errorInfo);
          (boundary as FZ.SuspenseBoundary | null)!.errorDigest = errorInfo;
          untrackBoundary(request, (boundary as FZ.SuspenseBoundary | null));
          (boundary as FZ.SuspenseBoundary | null)!.parentFlushed &&
            request.clientRenderedBoundaries.push((boundary as FZ.SuspenseBoundary | null)!);
        }
        (boundary as FZ.SuspenseBoundary | null)!.pendingTasks--;
        errorInfo = (boundary as FZ.SuspenseBoundary | null)!.row;
        null !== errorInfo &&
          0 === --errorInfo.pendingTasks &&
          finishSuspenseListRow(request, (errorInfo as FZ.SuspenseListRow | null)!);
        (boundary as FZ.SuspenseBoundary | null)!.fallbackAbortableTasks.forEach(function (fallbackTask) {
          return finishAbortedTask(fallbackTask, request, error);
        });
        (boundary as FZ.SuspenseBoundary | null)!.fallbackAbortableTasks.clear();
      }
      task = (task as FZ.Task).row;
      null !== task &&
        0 === --task.pendingTasks &&
        finishSuspenseListRow(request, (task as FZ.SuspenseListRow));
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
function completeShell(request: FZ.Request | (() => void)): void {
  null === (request as FZ.Request).trackedPostpones && safelyEmitEarlyPreloads((request as FZ.Request), !0);
  null === (request as FZ.Request).trackedPostpones && preparePreamble((request as FZ.Request));
  request = (request as FZ.Request).onShellReady;
  (request as () => void)();
}
function completeAll(request: FZ.Request | (() => void)): void {
  safelyEmitEarlyPreloads(
    (request as FZ.Request),
    null === (request as FZ.Request).trackedPostpones
      ? !0
      : null === (request as FZ.Request).completedRootSegment ||
          5 !== (request as FZ.Request).completedRootSegment!.status
  );
  preparePreamble((request as FZ.Request));
  request = (request as FZ.Request).onAllReady;
  (request as () => void)();
}
function queueCompletedSegment(boundary: FZ.SuspenseBoundary, segment: FZ.Segment): void {
  if (
    0 === segment.chunks.length &&
    1 === segment.children.length &&
    null === segment.children[0]!.boundary &&
    -1 === segment.children[0]!.id
  ) {
    var childSegment = segment.children[0]!;
    childSegment.id = segment.id;
    childSegment.parentFlushed = !0;
    (1 !== childSegment.status &&
      3 !== childSegment.status &&
      4 !== childSegment.status) ||
      queueCompletedSegment(boundary, childSegment);
  } else boundary.completedSegments.push(segment);
}
function finishedSegment(request: FZ.Request, boundary: FZ.SuspenseBoundary | null, segment: FZ.Segment | string[]): void {
  if (null !== byteLengthOfChunk) {
    segment = (segment as FZ.Segment).chunks;
    for (var segmentByteSize: FZ.ByteSize = 0, i = 0; i < (segment as string[]).length; i++)
      segmentByteSize += byteLengthOfChunk((segment as string[])[i]!);
    null === boundary
      ? (request.byteSize += segmentByteSize)
      : (boundary.byteSize += segmentByteSize);
  }
}
function finishedTask(request: FZ.Request, boundary: FZ.SuspenseBoundary | FZ.SuspenseListRow | null, row: FZ.SuspenseListRow | FZ.PostponedHoles | null, segment: FZ.Segment | FZ.SuspenseBoundary[] | null): void {
  null !== row &&
    (0 === --(row as FZ.SuspenseListRow).pendingTasks
      ? finishSuspenseListRow(request, (row as FZ.SuspenseListRow | null)!)
      : (row as FZ.SuspenseListRow | null)!.together && tryToResolveTogetherRow(request, (row as FZ.SuspenseListRow | null)!));
  request.allPendingTasks--;
  if (null === (boundary as FZ.SuspenseBoundary | null)) {
    if (null !== (segment as FZ.Segment | null) && (segment as FZ.Segment | null)!.parentFlushed) {
      if (null !== request.completedRootSegment)
        throw Error(
          "There can only be one root segment. This is a bug in React."
        );
      request.completedRootSegment = (segment as FZ.Segment | null);
    }
    request.pendingRootTasks--;
    0 === request.pendingRootTasks && completeShell(request);
  } else if (((boundary as FZ.SuspenseBoundary | null)!.pendingTasks--, 4 !== (boundary as FZ.SuspenseBoundary | null)!.status))
    if (0 === (boundary as FZ.SuspenseBoundary | null)!.pendingTasks)
      if (
        (0 === (boundary as FZ.SuspenseBoundary | null)!.status && ((boundary as FZ.SuspenseBoundary | null)!.status = 1),
        null !== (segment as FZ.Segment | null) &&
          (segment as FZ.Segment | null)!.parentFlushed &&
          (1 === (segment as FZ.Segment | null)!.status || 3 === (segment as FZ.Segment | null)!.status) &&
          queueCompletedSegment((boundary as FZ.SuspenseBoundary | null)!, (segment as FZ.Segment | null)!),
        (boundary as FZ.SuspenseBoundary | null)!.parentFlushed && request.completedBoundaries.push((boundary as FZ.SuspenseBoundary | null)!),
        1 === (boundary as FZ.SuspenseBoundary | null)!.status)
      )
        (row = (boundary as FZ.SuspenseBoundary | null)!.row),
          null !== row &&
            hoistHoistables((row as FZ.SuspenseListRow | null)!.hoistables, (boundary as FZ.SuspenseBoundary | null)!.contentState),
          isEligibleForOutlining(request, (boundary as FZ.SuspenseBoundary | null)!) ||
            (request.allPendingTasks++,
            (boundary as FZ.SuspenseBoundary | null)!.fallbackAbortableTasks.forEach(abortTaskSoft, request),
            (boundary as FZ.SuspenseBoundary | null)!.fallbackAbortableTasks.clear(),
            null !== row &&
              0 === --row.pendingTasks &&
              finishSuspenseListRow(request, (row as FZ.SuspenseListRow | null)!),
            request.allPendingTasks--),
          0 === request.pendingRootTasks &&
            null === request.trackedPostpones &&
            null !== (boundary as FZ.SuspenseBoundary | null)!.preamble &&
            preparePreamble(request);
      else {
        if (
          5 === (boundary as FZ.SuspenseBoundary | null)!.status &&
          ((boundary = (boundary as FZ.SuspenseBoundary | null)!.row), null !== boundary)
        ) {
          if (null !== request.trackedPostpones) {
            row = request.trackedPostpones;
            var postponedRow: FZ.SuspenseListRow | number | null = (boundary as FZ.SuspenseListRow | null)!.next;
            if (
              null !== postponedRow &&
              ((segment = (postponedRow as FZ.SuspenseListRow | null)!.boundaries), null !== segment)
            )
              for (
                (postponedRow as FZ.SuspenseListRow | null)!.boundaries = null, postponedRow = 0;
                postponedRow < (segment as FZ.SuspenseBoundary[] | null)!.length;
                postponedRow++
              ) {
                var postponedBoundary = (segment as FZ.SuspenseBoundary[] | null)![postponedRow]!;
                trackPostponedBoundary(request, row, postponedBoundary);
                finishedTask(request, postponedBoundary, null, null);
              }
          }
          request.allPendingTasks++;
          0 === --boundary.pendingTasks &&
            finishSuspenseListRow(request, (boundary as FZ.SuspenseListRow | null)!);
          request.allPendingTasks--;
        }
      }
    else
      null === (segment as FZ.Segment | null) ||
        !(segment as FZ.Segment | null)!.parentFlushed ||
        (1 !== (segment as FZ.Segment | null)!.status && 3 !== (segment as FZ.Segment | null)!.status) ||
        (queueCompletedSegment((boundary as FZ.SuspenseBoundary | null)!, (segment as FZ.Segment | null)!),
        1 === (boundary as FZ.SuspenseBoundary | null)!.completedSegments.length &&
          (boundary as FZ.SuspenseBoundary | null)!.parentFlushed &&
          request.partialBoundaries.push((boundary as FZ.SuspenseBoundary | null)!)),
        (boundary = (boundary as FZ.SuspenseBoundary | null)!.row),
        null !== boundary &&
          (boundary as FZ.SuspenseListRow | null)!.together &&
          tryToResolveTogetherRow(request, (boundary as FZ.SuspenseListRow | null)!);
  0 === request.allPendingTasks && completeAll(request);
}
function performWork(request$jscomp$1: FZ.Request): void {
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
        var task = pingedTasks[i]!,
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
                  var request$jscomp$0: FZ.Request | FZ.Segment = request;
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
            ((request$jscomp$0 = segment), 0 === request$jscomp$0.status)
          ) {
            var prevTask$jscomp$0 = request.currentTask;
            request.currentTask = task;
            switchContext(task.context);
            var childrenLength: FZ.ChunkIndex = request$jscomp$0.children.length as FZ.ChunkIndex,
              chunkLength: FZ.ChunkIndex = request$jscomp$0.chunks.length as FZ.ChunkIndex,
              startNode$jscomp$0 = task.node;
            try {
              retryNode(request, task),
                pushSegmentFinale(
                  request$jscomp$0.chunks,
                  request.renderState,
                  request$jscomp$0.lastPushedText,
                  request$jscomp$0.textEmbedded
                ),
                task.abortSet.delete(task),
                (request$jscomp$0.status = 1),
                finishedSegment(
                  request,
                  task.blockedBoundary,
                  request$jscomp$0
                ),
                finishedTask(
                  request,
                  task.blockedBoundary,
                  task.row,
                  request$jscomp$0
                );
            } catch (thrownValue: FZ.Thrown) {
              resetHooksState();
              request$jscomp$0.children.length = childrenLength;
              request$jscomp$0.chunks.length = chunkLength;
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
                    request$jscomp$0.status = 0;
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
                    request$jscomp$0.status = 0;
                    task.thenableState = null;
                    request.pingedTasks.push(task);
                    break a;
                  }
                }
                var errorInfo$jscomp$0 = getThrownInfo(task.componentStack);
                task.abortSet.delete(task);
                request$jscomp$0.status = 4;
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
        segment.children[i]!,
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
      segment = boundary.completedSegments[0]!;
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
function flushSubtree(request: FZ.Request | FZ.RenderState | string, destination: FZ.Destination, segment: FZ.Segment | FZ.Segment[], hoistableState: FZ.HoistableState | FZ.SegmentId | null): boolean {
  (segment as FZ.Segment).parentFlushed = !0;
  switch ((segment as FZ.Segment).status) {
    case 0:
      (segment as FZ.Segment).id = (request as FZ.Request).nextSegmentId++;
    case 5:
      return (
        (hoistableState = (segment as FZ.Segment).id as FZ.SegmentId),
        ((segment as FZ.Segment).lastPushedText = !1),
        ((segment as FZ.Segment).textEmbedded = !1),
        (request = (request as FZ.Request).renderState),
        writeChunk(destination, '<template id="'),
        writeChunk(destination, (request as FZ.RenderState).placeholderPrefix),
        (request = hoistableState.toString(16)),
        writeChunk(destination, request),
        !!destination.write('"></template>')
      );
    case 1:
      (segment as FZ.Segment).status = 2;
      var r: boolean | FZ.Segment = !0,
        chunks = (segment as FZ.Segment).chunks,
        chunkIdx: number = 0;
      segment = (segment as FZ.Segment).children;
      for (var childIdx: number = 0; childIdx < (segment as FZ.Segment[]).length; childIdx++) {
        for (r = (segment as FZ.Segment[])[childIdx]!; chunkIdx < (r as FZ.Segment).index; chunkIdx++)
          writeChunk(destination, chunks[chunkIdx]!);
        r = flushSegment((request as FZ.Request), destination, r, (hoistableState as FZ.HoistableState | null));
      }
      for (; chunkIdx < chunks.length - 1; chunkIdx++)
        writeChunk(destination, chunks[chunkIdx]!);
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
function flushSegment(request: FZ.Request, destination: FZ.Destination, segment: FZ.Segment | FZ.SuspenseListRow | FZ.Segment[] | null, hoistableState: FZ.HoistableState | null): boolean {
  var boundary: FZ.SuspenseBoundary | FZ.ErrorDigest | null = (segment as FZ.Segment).boundary;
  if (null === boundary)
    return flushSubtree(request, destination, (segment as FZ.Segment), hoistableState);
  (segment as FZ.Segment).boundary = null;
  (boundary as FZ.SuspenseBoundary | null)!.parentFlushed = !0;
  if (4 === (boundary as FZ.SuspenseBoundary | null)!.status) {
    var row = (boundary as FZ.SuspenseBoundary | null)!.row;
    null !== row &&
      0 === --row.pendingTasks &&
      finishSuspenseListRow(request, row);
    boundary = (boundary as FZ.SuspenseBoundary | null)!.errorDigest;
    destination.write("\x3c!--$!--\x3e");
    writeChunk(destination, "<template");
    null != boundary &&
      (writeChunk(destination, ' data-dgst="'),
      writeChunk(destination, escapeTextForBrowser(boundary)),
      writeChunk(destination, '"'));
    destination.write("></template>");
    flushSubtree(request, destination, (segment as FZ.Segment), hoistableState);
  } else if (1 !== (boundary as FZ.SuspenseBoundary | null)!.status)
    0 === (boundary as FZ.SuspenseBoundary | null)!.status && ((boundary as FZ.SuspenseBoundary | null)!.rootSegmentID = request.nextSegmentId++),
      0 < (boundary as FZ.SuspenseBoundary | null)!.completedSegments.length &&
        request.partialBoundaries.push((boundary as FZ.SuspenseBoundary | null)!),
      writeStartPendingSuspenseBoundary(
        destination,
        request.renderState,
        (boundary as FZ.SuspenseBoundary | null)!.rootSegmentID as FZ.SegmentId
      ),
      hoistableState && hoistHoistables(hoistableState, (boundary as FZ.SuspenseBoundary | null)!.fallbackState),
      flushSubtree(request, destination, (segment as FZ.Segment), hoistableState);
  else if (
    !flushingPartialBoundaries &&
    isEligibleForOutlining(request, (boundary as FZ.SuspenseBoundary | null)!) &&
    (flushedByteSize + (boundary as FZ.SuspenseBoundary | null)!.byteSize > request.progressiveChunkSize ||
      hasSuspenseyContent((boundary as FZ.SuspenseBoundary | null)!.contentState, flushingShell) ||
      (boundary as FZ.SuspenseBoundary | null)!.defer)
  )
    ((boundary as FZ.SuspenseBoundary | null)!.rootSegmentID = request.nextSegmentId++),
      request.completedBoundaries.push((boundary as FZ.SuspenseBoundary | null)!),
      writeStartPendingSuspenseBoundary(
        destination,
        request.renderState,
        (boundary as FZ.SuspenseBoundary | null)!.rootSegmentID as FZ.SegmentId
      ),
      flushSubtree(request, destination, (segment as FZ.Segment), hoistableState);
  else {
    flushedByteSize += (boundary as FZ.SuspenseBoundary | null)!.byteSize;
    hoistableState && hoistHoistables(hoistableState, (boundary as FZ.SuspenseBoundary | null)!.contentState);
    segment = (boundary as FZ.SuspenseBoundary | null)!.row;
    null !== segment &&
      isEligibleForOutlining(request, (boundary as FZ.SuspenseBoundary | null)!) &&
      0 === --segment.pendingTasks &&
      finishSuspenseListRow(request, (segment as FZ.SuspenseListRow | null)!);
    destination.write("\x3c!--$--\x3e");
    segment = (boundary as FZ.SuspenseBoundary | null)!.completedSegments;
    if (1 !== (segment as FZ.Segment[]).length)
      throw Error(
        "A previously unvisited boundary must have exactly one root segment. This is a bug in React."
      );
    flushSegment(request, destination, (segment as FZ.Segment[])[0]!, hoistableState);
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
function flushCompletedBoundary(request: FZ.Request | FZ.RenderState, destination: FZ.Destination, boundary: FZ.SuspenseBoundary | FZ.HoistableState | boolean): boolean {
  flushedByteSize = (boundary as FZ.SuspenseBoundary).byteSize;
  for (
    var completedSegments: FZ.Segment[] | FZ.SuspenseListRow | FZ.ResumableState | string | null = (boundary as FZ.SuspenseBoundary).completedSegments, i: number = 0;
    i < (completedSegments as FZ.Segment[]).length;
    i++
  )
    flushPartiallyCompletedSegment(
      request,
      destination,
      (boundary as FZ.SuspenseBoundary),
      (completedSegments as FZ.Segment[])[i]!
    );
  (completedSegments as FZ.Segment[]).length = 0;
  completedSegments = (boundary as FZ.SuspenseBoundary).row;
  null !== (completedSegments as FZ.SuspenseListRow | null) &&
    isEligibleForOutlining((request as FZ.Request), (boundary as FZ.SuspenseBoundary)) &&
    0 === --completedSegments.pendingTasks &&
    finishSuspenseListRow((request as FZ.Request), (completedSegments as FZ.SuspenseListRow | null)!);
  writeHoistablesForBoundary(
    destination,
    (boundary as FZ.SuspenseBoundary).contentState,
    (request as FZ.Request).renderState
  );
  completedSegments = (request as FZ.Request).resumableState;
  request = (request as FZ.Request).renderState;
  i = (boundary as FZ.SuspenseBoundary).rootSegmentID;
  boundary = (boundary as FZ.SuspenseBoundary).contentState;
  var requiresStyleInsertion = (request as FZ.RenderState).stylesToHoist,
    requiresViewTransitions = 0 !== (completedSegments.instructions & 128);
  (request as FZ.RenderState).stylesToHoist = !1;
  writeChunk(destination, (request as FZ.RenderState).startInlineScript);
  writeChunk(destination, ">");
  requiresStyleInsertion
    ? (0 === (completedSegments.instructions & 4) &&
        ((completedSegments.instructions |= 4),
        writeChunk(
          destination,
          '$RX=function(b,c,d,e,f){var a=document.getElementById(b);a&&(b=a.previousSibling,b.data="$!",a=a.dataset,null!=c&&(a.dgst=c),d&&(a.msg=d),e&&(a.stck=e),f&&(a.cstck=f),b._reactRetry&&b._reactRetry())};'
        )),
      0 === (completedSegments.instructions & 2) &&
        ((completedSegments.instructions |= 2),
        writeChunk(
          destination,
          '$RB=[];$RV=function(a){$RT=performance.now();for(var b=0;b<a.length;b+=2){var c=a[b],e=a[b+1];null!==e.parentNode&&e.parentNode.removeChild(e);var f=c.parentNode;if(f){var g=c.previousSibling,h=0;do{if(c&&8===c.nodeType){var d=c.data;if("/$"===d||"/&"===d)if(0===h)break;else h--;else"$"!==d&&"$?"!==d&&"$~"!==d&&"$!"!==d&&"&"!==d||h++}d=c.nextSibling;f.removeChild(c);c=d}while(c);for(;e.firstChild;)f.insertBefore(e.firstChild,c);g.data="$";g._reactRetry&&requestAnimationFrame(g._reactRetry)}}a.length=0};\n$RC=function(a,b){if(b=document.getElementById(b))(a=document.getElementById(a))?(a.previousSibling.data="$~",$RB.push(a,b),2===$RB.length&&("number"!==typeof $RT?requestAnimationFrame($RV.bind(null,$RB)):(a=performance.now(),setTimeout($RV.bind(null,$RB),2300>a&&2E3<a?2300-a:$RT+300-a)))):b.parentNode.removeChild(b)};'
        )),
      requiresViewTransitions &&
        0 === (completedSegments.instructions & 256) &&
        ((completedSegments.instructions |= 256),
        writeChunk(
          destination,
          '$RV=function(B,g){function h(a,c){var e=a.getAttribute(c);e&&(c=a.style,l.push(a,c.viewTransitionName,c.viewTransitionClass),"auto"!==e&&(c.viewTransitionClass=e),(a=a.getAttribute("vt-name"))||(a="_T_"+N++ +"_"),a=CSS.escape(a)!==a?"r-"+btoa(a).replace(/=/g,""):a,c.viewTransitionName=a,C=!0)}var C=!1,N=0,l=[];try{var f=document.__reactViewTransition;if(f){f.finished.finally($RV.bind(null,g));return}var m=new Map;for(f=1;f<g.length;f+=2)for(var k=g[f].querySelectorAll("[vt-share]"),d=0;d<k.length;d++){var b=k[d];m.set(b.getAttribute("vt-name"),b)}var u=[];for(k=0;k<g.length;k+=2){var D=g[k],x=D.parentNode;if(x){var v=x.getBoundingClientRect();if(v.left||v.top||v.width||v.height){b=D;for(f=0;b;){if(8===b.nodeType){var t=b.data;if("/$"===t)if(0===f)break;else f--;else"$"!==t&&"$?"!==t&&"$~"!==t&&"$!"!==t||f++}else if(1===b.nodeType){d=b;var E=d.getAttribute("vt-name"),y=m.get(E);h(d,y?"vt-share":"vt-exit");y&&(h(y,"vt-share"),m.set(E,null));for(var F=d.querySelectorAll("[vt-share]"),\nz=0;z<F.length;z++){var G=F[z],H=G.getAttribute("vt-name"),I=m.get(H);I&&(h(G,"vt-share"),h(I,"vt-share"),m.set(H,null))}var J=d.querySelectorAll("[vt-parent-exit]");for(d=0;d<J.length;d++)h(J[d],"vt-parent-exit")}b=b.nextSibling}for(var K=g[k+1],n=K.firstElementChild;n;){null!==m.get(n.getAttribute("vt-name"))&&h(n,"vt-enter");var L=n.querySelectorAll("[vt-parent-enter]");for(b=0;b<L.length;b++)h(L[b],"vt-parent-enter");n=n.nextElementSibling}b=x;do for(var p=b.firstElementChild;p;){var M=p.getAttribute("vt-update");\nM&&"none"!==M&&!l.includes(p)&&h(p,"vt-update");p=p.nextElementSibling}while((b=b.parentNode)&&1===b.nodeType&&"none"!==b.getAttribute("vt-update"));u.push.apply(u,K.querySelectorAll(\'img[src]:not([loading="lazy"])\'))}}}if(C){var A=document.__reactViewTransition=document.startViewTransition({update:function(){B(g);for(var a=[document.documentElement.clientHeight,document.fonts.ready],c={},e=0;e<u.length;c={g:c.g},e++)if(c.g=u[e],!c.g.complete){var q=c.g.getBoundingClientRect();0<q.bottom&&0<q.right&&\nq.top<window.innerHeight&&q.left<window.innerWidth&&(q=new Promise(function(w){return function(r){w.g.addEventListener("load",r);w.g.addEventListener("error",r)}}(c)),a.push(q))}return Promise.race([Promise.all(a),new Promise(function(w){var r=performance.now();setTimeout(w,2300>r&&2E3<r?2300-r:500)})])},types:[]});A.ready.finally(function(){for(var a=l.length-3;0<=a;a-=3){var c=l[a],e=c.style;e.viewTransitionName=l[a+1];e.viewTransitionClass=l[a+1];""===c.getAttribute("style")&&c.removeAttribute("style")}});\nA.finished.finally(function(){document.__reactViewTransition===A&&(document.__reactViewTransition=null)});$RB=[];return}}catch(a){}B(g)}.bind(null,$RV);'
        )),
      0 === (completedSegments.instructions & 8)
        ? ((completedSegments.instructions |= 8),
          writeChunk(
            destination,
            '$RM=new Map;$RR=function(n,w,p){function u(q){this._p=null;q()}for(var r=new Map,t=document,h,b,e=t.querySelectorAll("link[data-precedence],style[data-precedence]"),v=[],k=0;b=e[k++];)"not all"===b.getAttribute("media")?v.push(b):("LINK"===b.tagName&&$RM.set(b.getAttribute("href"),b),r.set(b.dataset.precedence,h=b));e=0;b=[];var l,a;for(k=!0;;){if(k){var f=p[e++];if(!f){k=!1;e=0;continue}var c=!1,m=0;var d=f[m++];if(a=$RM.get(d)){var g=a._p;c=!0}else{a=t.createElement("link");a.href=d;a.rel=\n"stylesheet";for(a.dataset.precedence=l=f[m++];g=f[m++];)a.setAttribute(g,f[m++]);g=a._p=new Promise(function(q,x){a.onload=u.bind(a,q);a.onerror=u.bind(a,x)});$RM.set(d,a)}d=a.getAttribute("media");!g||d&&!matchMedia(d).matches||b.push(g);if(c)continue}else{a=v[e++];if(!a)break;l=a.getAttribute("data-precedence");a.removeAttribute("media")}c=r.get(l)||h;c===h&&(h=a);r.set(l,a);c?c.parentNode.insertBefore(a,c.nextSibling):(c=t.head,c.insertBefore(a,c.firstChild))}if(p=document.getElementById(n))p.previousSibling.data=\n"$~";Promise.all(b).then($RC.bind(null,n,w),$RX.bind(null,n,"CSS failed to load"))};$RR("'
          ))
        : writeChunk(destination, '$RR("'))
    : (0 === (completedSegments.instructions & 2) &&
        ((completedSegments.instructions |= 2),
        writeChunk(
          destination,
          '$RB=[];$RV=function(a){$RT=performance.now();for(var b=0;b<a.length;b+=2){var c=a[b],e=a[b+1];null!==e.parentNode&&e.parentNode.removeChild(e);var f=c.parentNode;if(f){var g=c.previousSibling,h=0;do{if(c&&8===c.nodeType){var d=c.data;if("/$"===d||"/&"===d)if(0===h)break;else h--;else"$"!==d&&"$?"!==d&&"$~"!==d&&"$!"!==d&&"&"!==d||h++}d=c.nextSibling;f.removeChild(c);c=d}while(c);for(;e.firstChild;)f.insertBefore(e.firstChild,c);g.data="$";g._reactRetry&&requestAnimationFrame(g._reactRetry)}}a.length=0};\n$RC=function(a,b){if(b=document.getElementById(b))(a=document.getElementById(a))?(a.previousSibling.data="$~",$RB.push(a,b),2===$RB.length&&("number"!==typeof $RT?requestAnimationFrame($RV.bind(null,$RB)):(a=performance.now(),setTimeout($RV.bind(null,$RB),2300>a&&2E3<a?2300-a:$RT+300-a)))):b.parentNode.removeChild(b)};'
        )),
      requiresViewTransitions &&
        0 === (completedSegments.instructions & 256) &&
        ((completedSegments.instructions |= 256),
        writeChunk(
          destination,
          '$RV=function(B,g){function h(a,c){var e=a.getAttribute(c);e&&(c=a.style,l.push(a,c.viewTransitionName,c.viewTransitionClass),"auto"!==e&&(c.viewTransitionClass=e),(a=a.getAttribute("vt-name"))||(a="_T_"+N++ +"_"),a=CSS.escape(a)!==a?"r-"+btoa(a).replace(/=/g,""):a,c.viewTransitionName=a,C=!0)}var C=!1,N=0,l=[];try{var f=document.__reactViewTransition;if(f){f.finished.finally($RV.bind(null,g));return}var m=new Map;for(f=1;f<g.length;f+=2)for(var k=g[f].querySelectorAll("[vt-share]"),d=0;d<k.length;d++){var b=k[d];m.set(b.getAttribute("vt-name"),b)}var u=[];for(k=0;k<g.length;k+=2){var D=g[k],x=D.parentNode;if(x){var v=x.getBoundingClientRect();if(v.left||v.top||v.width||v.height){b=D;for(f=0;b;){if(8===b.nodeType){var t=b.data;if("/$"===t)if(0===f)break;else f--;else"$"!==t&&"$?"!==t&&"$~"!==t&&"$!"!==t||f++}else if(1===b.nodeType){d=b;var E=d.getAttribute("vt-name"),y=m.get(E);h(d,y?"vt-share":"vt-exit");y&&(h(y,"vt-share"),m.set(E,null));for(var F=d.querySelectorAll("[vt-share]"),\nz=0;z<F.length;z++){var G=F[z],H=G.getAttribute("vt-name"),I=m.get(H);I&&(h(G,"vt-share"),h(I,"vt-share"),m.set(H,null))}var J=d.querySelectorAll("[vt-parent-exit]");for(d=0;d<J.length;d++)h(J[d],"vt-parent-exit")}b=b.nextSibling}for(var K=g[k+1],n=K.firstElementChild;n;){null!==m.get(n.getAttribute("vt-name"))&&h(n,"vt-enter");var L=n.querySelectorAll("[vt-parent-enter]");for(b=0;b<L.length;b++)h(L[b],"vt-parent-enter");n=n.nextElementSibling}b=x;do for(var p=b.firstElementChild;p;){var M=p.getAttribute("vt-update");\nM&&"none"!==M&&!l.includes(p)&&h(p,"vt-update");p=p.nextElementSibling}while((b=b.parentNode)&&1===b.nodeType&&"none"!==b.getAttribute("vt-update"));u.push.apply(u,K.querySelectorAll(\'img[src]:not([loading="lazy"])\'))}}}if(C){var A=document.__reactViewTransition=document.startViewTransition({update:function(){B(g);for(var a=[document.documentElement.clientHeight,document.fonts.ready],c={},e=0;e<u.length;c={g:c.g},e++)if(c.g=u[e],!c.g.complete){var q=c.g.getBoundingClientRect();0<q.bottom&&0<q.right&&\nq.top<window.innerHeight&&q.left<window.innerWidth&&(q=new Promise(function(w){return function(r){w.g.addEventListener("load",r);w.g.addEventListener("error",r)}}(c)),a.push(q))}return Promise.race([Promise.all(a),new Promise(function(w){var r=performance.now();setTimeout(w,2300>r&&2E3<r?2300-r:500)})])},types:[]});A.ready.finally(function(){for(var a=l.length-3;0<=a;a-=3){var c=l[a],e=c.style;e.viewTransitionName=l[a+1];e.viewTransitionClass=l[a+1];""===c.getAttribute("style")&&c.removeAttribute("style")}});\nA.finished.finally(function(){document.__reactViewTransition===A&&(document.__reactViewTransition=null)});$RB=[];return}}catch(a){}B(g)}.bind(null,$RV);'
        )),
      writeChunk(destination, '$RC("'));
  completedSegments = i.toString(16);
  writeChunk(destination, (request as FZ.RenderState).boundaryPrefix);
  writeChunk(destination, (completedSegments as string));
  writeChunk(destination, '","');
  writeChunk(destination, (request as FZ.RenderState).segmentPrefix);
  writeChunk(destination, (completedSegments as string));
  requiresStyleInsertion
    ? (writeChunk(destination, '",'),
      writeStyleResourceDependenciesInJS(destination, (boundary as FZ.HoistableState)))
    : writeChunk(destination, '"');
  boundary = !!destination.write(")\x3c/script>");
  return writeBootstrap(destination, (request as FZ.RenderState)) && boundary;
}
function flushPartiallyCompletedSegment(
  request: FZ.Request | FZ.RenderState,
  destination: FZ.Destination | any,
  boundary: FZ.SuspenseBoundary | any,
  segment: FZ.Segment
): boolean {
  if (2 === segment.status) return !0;
  var hoistableState = (boundary as FZ.SuspenseBoundary).contentState,
    segmentID: FZ.SegmentId | string = segment.id;
  if (-1 === segmentID) {
    if (-1 === (segment.id = (boundary as FZ.SuspenseBoundary).rootSegmentID))
      throw Error(
        "A root segment ID must have been assigned by now. This is a bug in React."
      );
    return flushSegmentContainer((request as FZ.Request), destination, segment, hoistableState);
  }
  if (segmentID === (boundary as FZ.SuspenseBoundary).rootSegmentID)
    return flushSegmentContainer((request as FZ.Request), destination, segment, hoistableState);
  flushSegmentContainer((request as FZ.Request), destination, segment, hoistableState);
  boundary = (request as FZ.Request).resumableState;
  request = (request as FZ.Request).renderState;
  writeChunk(destination, (request as FZ.RenderState).startInlineScript);
  writeChunk(destination, ">");
  0 === (boundary.instructions & 1)
    ? ((boundary.instructions |= 1),
      writeChunk(
        destination,
        '$RS=function(a,b){a=document.getElementById(a);b=document.getElementById(b);for(a.parentNode.removeChild(a);a.firstChild;)b.parentNode.insertBefore(a.firstChild,b);b.parentNode.removeChild(b)};$RS("'
      ))
    : writeChunk(destination, '$RS("');
  writeChunk(destination, (request as FZ.RenderState).segmentPrefix);
  segmentID = segmentID.toString(16);
  writeChunk(destination, segmentID);
  writeChunk(destination, '","');
  writeChunk(destination, (request as FZ.RenderState).placeholderPrefix);
  writeChunk(destination, segmentID);
  destination = !!destination.write('")\x3c/script>');
  return destination;
}
var flushingPartialBoundaries: boolean = !1,
  flushingShell: boolean = !1;
function flushCompletedQueues(request: FZ.Request, destination: FZ.Destination): void {
  try {
    if (!(0 < request.pendingRootTasks)) {
      var i: number | FZ.PostponedState | FZ.ResumableState | null,
        completedRootSegment: FZ.Segment | number | null = request.completedRootSegment;
      if (null !== completedRootSegment) {
        if (5 === completedRootSegment.status) return;
        var completedPreambleSegments: FZ.Segment[][] | number | null = request.completedPreambleSegments;
        if (null === completedPreambleSegments) return;
        flushedByteSize = request.byteSize;
        var resumableState: FZ.ResumableState | number = request.resumableState,
          renderState: FZ.RenderState | number = request.renderState,
          preamble = renderState.preamble,
          htmlChunks = preamble.htmlChunks,
          headChunks = preamble.headChunks,
          i$jscomp$0: number;
        if (htmlChunks) {
          for (i$jscomp$0 = 0; i$jscomp$0 < htmlChunks.length; i$jscomp$0++)
            writeChunk(destination, htmlChunks[i$jscomp$0]!);
          if (headChunks)
            for (i$jscomp$0 = 0; i$jscomp$0 < headChunks.length; i$jscomp$0++)
              writeChunk(destination, headChunks[i$jscomp$0]!);
          else
            writeChunk(destination, startChunkForTag("head")),
              writeChunk(destination, ">");
        } else if (headChunks)
          for (i$jscomp$0 = 0; i$jscomp$0 < headChunks.length; i$jscomp$0++)
            writeChunk(destination, headChunks[i$jscomp$0]!);
        var charsetChunks = renderState.charsetChunks;
        for (i$jscomp$0 = 0; i$jscomp$0 < charsetChunks.length; i$jscomp$0++)
          writeChunk(destination, charsetChunks[i$jscomp$0]!);
        charsetChunks.length = 0;
        renderState.preconnects.forEach(flushResource, destination);
        renderState.preconnects.clear();
        var viewportChunks = renderState.viewportChunks;
        for (i$jscomp$0 = 0; i$jscomp$0 < viewportChunks.length; i$jscomp$0++)
          writeChunk(destination, viewportChunks[i$jscomp$0]!);
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
          writeChunk(destination, importMapChunks[i$jscomp$0]!);
        importMapChunks.length = 0;
        renderState.bootstrapScripts.forEach(flushResource, destination);
        renderState.scripts.forEach(flushResource, destination);
        renderState.scripts.clear();
        renderState.bulkPreloads.forEach(flushResource, destination);
        renderState.bulkPreloads.clear();
        htmlChunks || headChunks || (resumableState.instructions |= 32);
        var hoistableChunks = renderState.hoistableChunks;
        for (i$jscomp$0 = 0; i$jscomp$0 < hoistableChunks.length; i$jscomp$0++)
          writeChunk(destination, hoistableChunks[i$jscomp$0]!);
        for (
          resumableState = hoistableChunks.length = 0;
          resumableState < completedPreambleSegments.length;
          resumableState++
        ) {
          var segments = completedPreambleSegments[resumableState]!;
          for (renderState = 0; renderState < segments.length; renderState++)
            flushSegment(request, destination, segments[renderState]!, null);
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
            writeChunk(destination, bodyChunks[completedPreambleSegments]!);
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
      var renderState$jscomp$1: FZ.RenderState | FZ.Destination = request.renderState;
      completedRootSegment = 0;
      var viewportChunks$jscomp$0 = (renderState$jscomp$1 as FZ.RenderState).viewportChunks;
      for (
        completedRootSegment = 0;
        completedRootSegment < viewportChunks$jscomp$0.length;
        completedRootSegment++
      )
        writeChunk(destination, viewportChunks$jscomp$0[completedRootSegment]!);
      viewportChunks$jscomp$0.length = 0;
      (renderState$jscomp$1 as FZ.RenderState).preconnects.forEach(flushResource, destination);
      (renderState$jscomp$1 as FZ.RenderState).preconnects.clear();
      (renderState$jscomp$1 as FZ.RenderState).fontPreloads.forEach(flushResource, destination);
      (renderState$jscomp$1 as FZ.RenderState).fontPreloads.clear();
      (renderState$jscomp$1 as FZ.RenderState).highImagePreloads.forEach(
        flushResource,
        destination
      );
      (renderState$jscomp$1 as FZ.RenderState).highImagePreloads.clear();
      (renderState$jscomp$1 as FZ.RenderState).styles.forEach(preloadLateStyles, destination);
      (renderState$jscomp$1 as FZ.RenderState).scripts.forEach(flushResource, destination);
      (renderState$jscomp$1 as FZ.RenderState).scripts.clear();
      (renderState$jscomp$1 as FZ.RenderState).bulkPreloads.forEach(flushResource, destination);
      (renderState$jscomp$1 as FZ.RenderState).bulkPreloads.clear();
      var hoistableChunks$jscomp$0 = (renderState$jscomp$1 as FZ.RenderState).hoistableChunks;
      for (
        completedRootSegment = 0;
        completedRootSegment < hoistableChunks$jscomp$0.length;
        completedRootSegment++
      )
        writeChunk(destination, hoistableChunks$jscomp$0[completedRootSegment]!);
      hoistableChunks$jscomp$0.length = 0;
      var clientRenderedBoundaries: FZ.SuspenseBoundary[] | FZ.Request = request.clientRenderedBoundaries;
      for (i = 0; (i as number) < clientRenderedBoundaries.length; i++) {
        var boundary: FZ.SuspenseBoundary | FZ.Destination = clientRenderedBoundaries[(i as number)];
        renderState$jscomp$1 = destination;
        var resumableState$jscomp$1 = request.resumableState,
          renderState$jscomp$2 = request.renderState,
          id: FZ.SegmentId = (boundary as FZ.SuspenseBoundary).rootSegmentID as FZ.SegmentId,
          errorDigest = (boundary as FZ.SuspenseBoundary).errorDigest;
        writeChunk(
          renderState$jscomp$1,
          renderState$jscomp$2.startInlineScript
        );
        writeChunk(renderState$jscomp$1, ">");
        0 === (resumableState$jscomp$1.instructions & 4)
          ? ((resumableState$jscomp$1.instructions |= 4),
            writeChunk(
              renderState$jscomp$1,
              '$RX=function(b,c,d,e,f){var a=document.getElementById(b);a&&(b=a.previousSibling,b.data="$!",a=a.dataset,null!=c&&(a.dgst=c),d&&(a.msg=d),e&&(a.stck=e),f&&(a.cstck=f),b._reactRetry&&b._reactRetry())};;$RX("'
            ))
          : writeChunk(renderState$jscomp$1, '$RX("');
        writeChunk(renderState$jscomp$1, renderState$jscomp$2.boundaryPrefix);
        writeChunk(renderState$jscomp$1, id.toString(16));
        writeChunk(renderState$jscomp$1, '"');
        null != errorDigest &&
          (writeChunk(renderState$jscomp$1, ","),
          null == errorDigest
            ? writeChunk(renderState$jscomp$1, "null")
            : writeChunk(
                renderState$jscomp$1,
                escapeJSStringsForInstructionScripts(errorDigest)
              ));
        var JSCompiler_inline_result: boolean | number =
          !!renderState$jscomp$1.write(")\x3c/script>");
        if (!JSCompiler_inline_result) {
          request.destination = null;
          i++;
          clientRenderedBoundaries.splice(0, (i as number));
          return;
        }
      }
      clientRenderedBoundaries.splice(0, (i as number));
      var completedBoundaries = request.completedBoundaries;
      for (i = 0; (i as number) < completedBoundaries.length; i++)
        if (
          !flushCompletedBoundary(request, destination, completedBoundaries[(i as number)]!)
        ) {
          request.destination = null;
          i++;
          completedBoundaries.splice(0, (i as number));
          return;
        }
      completedBoundaries.splice(0, (i as number));
      flushingPartialBoundaries = !0;
      var partialBoundaries = request.partialBoundaries;
      for (i = 0; (i as number) < partialBoundaries.length; i++) {
        var boundary$71 = partialBoundaries[(i as number)]!;
        a: {
          clientRenderedBoundaries = request;
          boundary = destination;
          flushedByteSize = boundary$71.byteSize;
          var completedSegments = boundary$71.completedSegments;
          for (
            JSCompiler_inline_result = 0;
            JSCompiler_inline_result < completedSegments.length;
            JSCompiler_inline_result++
          )
            if (
              !flushPartiallyCompletedSegment(
                clientRenderedBoundaries,
                boundary,
                boundary$71,
                completedSegments[JSCompiler_inline_result]!
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
                  clientRenderedBoundaries,
                  row,
                  row.hoistables
                )
              : row.pendingTasks--);
          JSCompiler_inline_result$jscomp$0 = writeHoistablesForBoundary(
            boundary,
            boundary$71.contentState,
            clientRenderedBoundaries.renderState
          );
        }
        if (!JSCompiler_inline_result$jscomp$0) {
          request.destination = null;
          i++;
          partialBoundaries.splice(0, (i as number));
          return;
        }
      }
      partialBoundaries.splice(0, (i as number));
      flushingPartialBoundaries = !1;
      var largeBoundaries = request.completedBoundaries;
      for (i = 0; (i as number) < largeBoundaries.length; i++)
        if (!flushCompletedBoundary(request, destination, largeBoundaries[(i as number)]!)) {
          request.destination = null;
          i++;
          largeBoundaries.splice(0, (i as number));
          return;
        }
      largeBoundaries.splice(0, (i as number));
    }
  } finally {
    (flushingPartialBoundaries = !1),
      (i = request.postponedState),
      null !== (i as FZ.PostponedState | null) && ((i as FZ.PostponedState | null)!.nextSegmentId = request.nextSegmentId as FZ.SegmentId),
      0 === request.allPendingTasks &&
      0 === request.clientRenderedBoundaries.length &&
      0 === request.completedBoundaries.length
        ? ((request.flushScheduled = !1),
          (i = request.resumableState),
          i.hasBody && writeChunk(destination, endChunkForTag("body")),
          i.hasHtml && writeChunk(destination, endChunkForTag("html")),
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
function startFlowing(request: FZ.Request | Error | any, destination: FZ.Destination): void {
  if (12 === (request as FZ.Request).status)
    ((request as FZ.Request).status = 13),
      (request = (request as FZ.Request).fatalError),
      isRecoverableError(request) &&
        (request = cloneRecoverableErrorAsFatal(request)),
      closeWithError(destination, request);
  else if (13 !== (request as FZ.Request).status && null === (request as FZ.Request).destination) {
    (request as FZ.Request).destination = destination;
    try {
      flushCompletedQueues((request as FZ.Request), destination);
    } catch (error$73: FZ.Thrown) {
      logRecoverableError((request as FZ.Request), error$73, {}), fatalError((request as FZ.Request), error$73);
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
function endRenderLifetime(request: FZ.Request | any): void {
  request = (request as FZ.Request).renderLifetimeController;
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
function getPostponedState(request: FZ.Request): FZ.PostponedState | null {
  var trackedPostpones: FZ.PostponedHoles | FZ.PostponedState | null = request.trackedPostpones;
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
  trackedPostpones = {
    nextSegmentId: nextSegmentId,
    rootFormatContext: request.rootFormatContext,
    progressiveChunkSize: request.progressiveChunkSize,
    resumableState: request.resumableState,
    replayNodes: trackedPostpones.rootNodes,
    replaySlots: replaySlots
  };
  hasFlushableShell && (request.postponedState = trackedPostpones);
  return trackedPostpones;
}
function ensureCorrectIsomorphicReactVersion(): void {
  var isomorphicReactPackageVersion = React.version;
  if ("19.3.1" !== isomorphicReactPackageVersion)
    throw Error(
      'Incompatible React versions: The "react" and "react-dom" packages must have the exact same version. Instead got:\n  - react:      ' +
        (isomorphicReactPackageVersion +
          "\n  - react-dom:  19.3.1\nLearn more: https://react.dev/warnings/version-mismatch")
    );
}
ensureCorrectIsomorphicReactVersion();
hasOwnProperty.call(ArrayBuffer.prototype, "detached");
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
        function () {
          var writable: FZ.FakeWritable | undefined,
            stream: any | FZ.StaticResult = new ReadableStream(
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
          stream = { postponed: getPostponedState(request), prelude: stream };
          resolve((stream as FZ.StaticResult));
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
        function () {
          var readable: any | FZ.StaticResult = new stream.Readable({
              read: function () {
                startFlowing(request, writable);
              }
            }),
            writable = createFakeWritableFromReadable(readable);
          readable = {
            postponed: getPostponedState(request),
            prelude: readable
          };
          resolve((readable as FZ.StaticResult));
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
      function () {
        var writable: FZ.FakeWritable | undefined,
          stream: any | FZ.StaticResult = new ReadableStream(
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
        stream = { postponed: getPostponedState(request), prelude: stream };
        resolve((stream as FZ.StaticResult));
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
      function () {
        var readable: any | FZ.StaticResult = new stream.Readable({
            read: function () {
              startFlowing(request, writable);
            }
          }),
          writable = createFakeWritableFromReadable(readable);
        readable = { postponed: getPostponedState(request), prelude: readable };
        resolve((readable as FZ.StaticResult));
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
exports.version = "19.3.1";
declare namespace FZ {
  type FulfilledValue = any;
  type ComparedValue = any;
}
declare namespace FZ {
  type MemoValue = any;
  type UsedValue = any;
}
declare namespace FZ {
  type int32 = import("bun").int32;
  type RequestStatus = int32;
  type SegmentStatus = int32;
  type BoundaryStatus = int32;
  type StylesheetState = int32;
  type InsertionMode = int32;
  type TagScope = int32;
  type InstructionState = int32;
  type SegmentId = number;
  type ChildIndex = number;
  type TaskCount = int32;
  type ChunkIndex = number;
  type TreeId = int32;
  type ContextDepth = number;
  type HookCounter = number;
  type ByteSize = number;
  type HeaderCapacity = number;
  type ReactNode = any;
  type ReactElement = any;
  type Props = any;
  type PropValue = any;
  type ElementType = any;
  type ComponentName = any;
  type KeyOrIndex = any;
  type FunctionComponent = any;
  type ClassComponent = any;
  type ClassInstance = any;
  type ClassState = any;
  type Ref = any;
  type ReactContext = any;
  type ContextValue = any;
  type LazyComponent = any;
  type Thenable = any;
  type Recoverable = any;
  type Thrown = any;
  type HookState = any;
  type HookDeps = any;
  type IteratorFn = any;
  type Destination = any;
  type StreamController = any;
  type NodeReadable = any;
  type WebReadableStream = any;
  type AbortSignalGiven = any;
  type AbortControllerGiven = any;
  type TextEncoderGiven = any;
  type Options = any;
  type PostponedStateGiven = any;
  type ReactFormState = any;
  type FormAction = any;
  type CustomFormFields = any;
  type FormDataGiven = any;
  type Nonce = any;
  type SelectedValue = any;
  type ViewTransitionValue = any;
  type BootstrapScriptContent = any;
  type BootstrapScripts = any;
  type ImportMap = any;
  type ReactModule = any;
  type ReactDOMModule = any;
  type UtilModule = any;
  type StreamModule = any;
  type SharedInternals = any;
  type DOMSharedInternals = any;
  type HostDispatcherGiven = any;
  type GivenFunction = any;
  type Chunk = string;
  type PrecomputedChunk = string;
  type Resource = Chunk[];
  type PropsBag = { [name: string]: any };
  type Assign = (target: PropsBag, ...sources: any[]) => PropsBag;
  type NameCache = { [name: string]: boolean };
  type PreloadState = PropValue[];
  type ResourceDict = { [key: string]: PreloadState | null };
  type ExistsDict = { [key: string]: null };
  type UnknownResourceDict = { [as: string]: ResourceDict };
  type ConnectBucket = "default" | "anonymous" | "credentials";
  type ConnectResources = { [bucket: string]: ExistsDict };
  type SlotMap = { [index: string]: SegmentId | undefined };
  type ThrownInfo = { [name: string]: unknown };
  type KeyNode = [parent: KeyNode | null, name: ComponentName, keyOrIndex: KeyOrIndex];
  type ReplayNode = [name: ComponentName, keyOrIndex: KeyOrIndex, children: ReplayNode[], slots: ResumeSlots, fallback?: ReplayNode | null, rootSegmentID?: SegmentId];
  type ResumeSlots = SlotMap | SegmentId | null;
  type ThenableState = Thenable[];
  type MemoState = [value: any, deps: HookDeps];
  type DispatchTuple = [state: HookState, dispatch: Dispatch | null];
  type OptimisticTuple = [state: HookState, dispatch: Dispatch];
  type TransitionTuple = [isPending: boolean, start: (callback?: GivenFunction) => void];
  type ActionStateTuple = [state: HookState, dispatch: ActionDispatch, isPending: boolean];
  type ComponentFrameSample = [sample: string | null, control: string | null];
  interface Request {
    destination: Destination;
    flushScheduled: boolean;
    resumableState: ResumableState;
    renderState: RenderState;
    rootFormatContext: FormatContext;
    progressiveChunkSize: number;
    status: RequestStatus;
    fatalError: Thrown;
    aborted: boolean;
    nextSegmentId: number;
    allPendingTasks: number;
    pendingRootTasks: number;
    completedRootSegment: Segment | null;
    completedPreambleSegments: Segment[][] | null;
    byteSize: ByteSize;
    abortableTasks: Set<Task>;
    pingedTasks: Task[];
    currentTask: Task | null;
    clientRenderedBoundaries: SuspenseBoundary[];
    completedBoundaries: SuspenseBoundary[];
    partialBoundaries: SuspenseBoundary[];
    trackedPostpones: PostponedHoles | null;
    postponedState: PostponedState | null;
    onError: ErrorHandler;
    onBrowserBailout: BailoutHandler;
    onAllReady: () => void;
    onShellReady: () => void;
    onShellError: (error: Thrown) => void;
    onFatalError: (error: Thrown) => void;
    renderLifetimeController: AbortControllerGiven;
    formState: ReactFormState;
  }
  interface RequestConstructor {
    new (
      resumableState: ResumableState,
      renderState: RenderState,
      rootFormatContext: FormatContext,
      progressiveChunkSize: number | undefined,
      onError: ErrorHandler | undefined,
      onBrowserBailout: BailoutHandler | undefined,
      onAllReady: (() => void) | undefined,
      onShellReady: (() => void) | undefined,
      onShellError: ((error: Thrown) => void) | undefined,
      onFatalError: ((error: Thrown) => void) | undefined,
      formState: ReactFormState
    ): Request;
    (this: Request,
      resumableState: ResumableState,
      renderState: RenderState,
      rootFormatContext: FormatContext,
      progressiveChunkSize: number | undefined,
      onError: ErrorHandler | undefined,
      onBrowserBailout: BailoutHandler | undefined,
      onAllReady: (() => void) | undefined,
      onShellReady: (() => void) | undefined,
      onShellError: ((error: Thrown) => void) | undefined,
      onFatalError: ((error: Thrown) => void) | undefined,
      formState: ReactFormState
    ): void;
  }
  type ErrorHandler = (error: Thrown, errorInfo: ThrownInfo) => any;
  type BailoutHandler = (error: Thrown, errorInfo: ThrownInfo) => void;
  type ErrorDigest = string | null | undefined;
  interface Task {
    replay: ReplaySet | null;
    node: ReactNode;
    childIndex: ChildIndex;
    ping: Ping;
    blockedBoundary: SuspenseBoundary | null;
    blockedSegment: Segment | null;
    blockedPreamble: PreambleState | null;
    hoistableState: HoistableState | null;
    abortSet: Set<Task>;
    keyPath: KeyNode | null;
    formatContext: FormatContext;
    context: ContextNode | null;
    treeContext: TreeContext;
    row: SuspenseListRow | null;
    componentStack: ComponentStackNode | null;
    thenableState: ThenableState | null;
  }
  interface Ping { resolve: () => void; reject: (error: Thrown) => void }
  interface Segment {
    status: SegmentStatus;
    parentFlushed: boolean;
    id: number;
    index: ChunkIndex;
    chunks: Chunk[];
    children: Segment[];
    preambleChildren: Segment[];
    parentFormatContext: FormatContext;
    boundary: SuspenseBoundary | null;
    lastPushedText: boolean;
    textEmbedded: boolean;
  }
  interface SuspenseBoundary {
    status: BoundaryStatus;
    rootSegmentID: number;
    parentFlushed: boolean;
    pendingTasks: number;
    row: SuspenseListRow | null;
    completedSegments: Segment[];
    byteSize: ByteSize;
    defer: boolean;
    fallbackAbortableTasks: Set<Task>;
    errorDigest: ErrorDigest;
    contentState: HoistableState;
    fallbackState: HoistableState;
    preamble: BoundaryPreamble | null;
    tracked: TrackedBoundary | null;
  }
  interface BoundaryPreamble { content: PreambleState; fallback: PreambleState }
  interface TrackedBoundary { contentKeyPath: KeyNode | null; fallbackNode: ReplayNode | null }
  interface SuspenseListRow {
    pendingTasks: number;
    boundaries: SuspenseBoundary[] | null;
    hoistables: HoistableState;
    inheritedHoistables: HoistableState | null;
    together: boolean;
    next: SuspenseListRow | null;
  }
  interface PostponedHoles { workingMap: Map<KeyNode, ReplayNode>; rootNodes: ReplayNode[]; rootSlots: ResumeSlots }
  interface ReplaySet { nodes: ReplayNode[]; slots: ResumeSlots; pendingTasks: number }
  interface PostponedState {
    nextSegmentId: SegmentId;
    rootFormatContext: FormatContext;
    progressiveChunkSize: number;
    resumableState: ResumableState;
    replayNodes: ReplayNode[];
    replaySlots: ResumeSlots;
  }
  interface RenderState {
    placeholderPrefix: PrecomputedChunk;
    segmentPrefix: PrecomputedChunk;
    boundaryPrefix: PrecomputedChunk;
    startInlineScript: PrecomputedChunk;
    startInlineStyle: PrecomputedChunk;
    preamble: PreambleState;
    externalRuntimeScript: null;
    bootstrapChunks: Chunk[];
    importMapChunks: Chunk[];
    onHeaders: OnHeaders | null | undefined;
    headers: PreloadHeaders | null;
    resets: ResourceResets;
    charsetChunks: Chunk[];
    viewportChunks: Chunk[];
    hoistableChunks: Chunk[];
    preconnects: Set<Resource>;
    fontPreloads: Set<Resource>;
    highImagePreloads: Set<Resource>;
    styles: Map<string, StyleQueue>;
    bootstrapScripts: Set<Resource>;
    scripts: Set<Resource>;
    bulkPreloads: Set<Resource>;
    preloads: PreloadMaps;
    nonce: NoncePair;
    hoistableState: HoistableState | null;
    stylesToHoist: boolean;
  }
  type OnHeaders = (headers: PropsBag) => void;
  interface PreloadHeaders { preconnects: string; fontPreloads: string; highImagePreloads: string; remainingCapacity: HeaderCapacity }
  interface ResourceResets { font: ResourceDict; dns: ExistsDict; connect: ConnectResources; image: ResourceDict; style: ResourceDict }
  interface PreloadMaps {
    images: Map<string, Resource>;
    stylesheets: Map<string, Resource>;
    scripts: Map<string, Resource>;
    moduleScripts: Map<string, Resource>;
  }
  interface NoncePair { script: Nonce; style: Nonce }
  type ResumableState = any;
  interface PreambleState { htmlChunks: Chunk[] | null; headChunks: Chunk[] | null; bodyChunks: Chunk[] | null }
  interface FormatContext {
    insertionMode: InsertionMode;
    selectedValue: SelectedValue;
    tagScope: TagScope;
    viewTransition: ViewTransitionContext | null;
  }
  interface ViewTransitionContext {
    update: ViewTransitionValue;
    enter: ViewTransitionValue;
    exit: ViewTransitionValue;
    share: ViewTransitionValue;
    parentEnter: string;
    parentExit: string;
    name: ViewTransitionValue;
    autoName: ViewTransitionValue;
    nameIdx: number;
  }
  interface HoistableState { styles: Set<StyleQueue>; stylesheets: Set<StylesheetResource>; suspenseyImages: boolean }
  interface StyleQueue { precedence: Chunk; rules: Chunk[]; hrefs: Chunk[]; sheets: Map<string, StylesheetResource> }
  interface StylesheetResource { state: StylesheetState; props: PropsBag }
  interface ContextNode {
    parent: ContextNode | null;
    depth: ContextDepth;
    context: ReactContext;
    parentValue: ContextValue;
    value: ContextValue;
  }
  interface ComponentStackNode { parent: ComponentStackNode | null; type: ElementType }
  interface TreeContext { id: TreeId; overflow: string }
  interface Hook { memoizedState: HookState; queue: UpdateQueue | null; next: Hook | null }
  interface UpdateQueue { last: Update | null; dispatch: Dispatch | null }
  interface Update { action: HookState; next: Update | null }
  interface RefObject { current: any }
  type Dispatch = (action: any) => void;
  type Reducer = (state: any, action: any) => any;
  interface ActionDispatch { (payload: any): void; $$FORM_ACTION?: (prefix: any) => CustomFormFields }
  interface Dispatcher {
    readContext(context: ReactContext): ContextValue;
    use(usable: any): any;
    useContext(context: ReactContext): ContextValue;
    useMemo(nextCreate: () => any, deps?: HookDeps): any;
    useReducer(reducer: Reducer, initialArg: any, init?: (initialArg: any) => any): DispatchTuple;
    useRef(initialValue: any): RefObject;
    useState(initialState?: any): DispatchTuple;
    useInsertionEffect(create?: GivenFunction, deps?: HookDeps): void;
    useLayoutEffect(create?: GivenFunction, deps?: HookDeps): void;
    useCallback(callback: GivenFunction, deps?: HookDeps): GivenFunction;
    useImperativeHandle(ref?: Ref, create?: GivenFunction, deps?: HookDeps): void;
    useEffect(create?: GivenFunction, deps?: HookDeps): void;
    useDebugValue(value?: any, formatterFn?: GivenFunction): void;
    useDeferredValue(value: any, initialValue?: any): any;
    useTransition(): TransitionTuple;
    useId(): string;
    useSyncExternalStore(subscribe: GivenFunction, getSnapshot: GivenFunction, getServerSnapshot?: GivenFunction): any;
    useOptimistic(passthrough: any, reducer?: GivenFunction): OptimisticTuple;
    useActionState(action: FormAction, initialState: any, permalink?: PropValue): ActionStateTuple;
    useFormState(action: FormAction, initialState: any, permalink?: PropValue): ActionStateTuple;
    useHostTransitionStatus(): FormStatusNotPending;
    useMemoCache(size: number): any[];
    useCacheRefresh(): () => void;
    useEffectEvent(callback?: GivenFunction): () => void;
  }
  interface AsyncDispatcher { getCacheForType(resourceType?: GivenFunction): any; cacheSignal(): any }
  interface FormStatusNotPending { pending: boolean; data: null; method: null; action: null }
  interface HostDispatcher {
    f: GivenFunction;
    r: GivenFunction;
    D(href: PropValue): void;
    C(href: PropValue, crossOrigin?: PropValue): void;
    L(href: PropValue, as: PropValue, options?: Options): void;
    m(href: PropValue, options?: Options): void;
    X(src: PropValue, options?: Options): void;
    S(href: PropValue, precedence?: PropValue, options?: Options): void;
    M(src: PropValue, options?: Options): void;
  }
  interface ClassComponentUpdater {
    enqueueSetState(inst: ClassInstance, payload: any, callback?: any): void;
    enqueueReplaceState(inst: ClassInstance, payload: any, callback?: any): void;
    enqueueForceUpdate(inst?: ClassInstance, callback?: any): void;
  }
  interface InternalInstance { queue: any[] | null; replace: boolean }
  interface ComponentIdentity { readonly $$fzIdentity?: never }
  interface EmptyContext { readonly $$fzEmptyContext?: never }
  interface RunInRootFrame { DetermineComponentFrameRoot: { (): ComponentFrameSample; displayName?: string } }
  interface FakeWritable { write(chunk: any): any; end(): void; destroy(error: Thrown): void }
  interface StaticResult { postponed: PostponedState | null; prelude: WebReadableStream }
  interface PipeableStream { pipe(destination: Destination): Destination; abort(reason?: Thrown): void }
}
declare var require: (name: string) => any;
declare var exports: any;
declare var console: { error(...data: any[]): void };
declare var Buffer: { byteLength(chunk: string, encoding: string): number };
declare var Bun: { hash(data: string): number | bigint };
declare var AbortController: new () => FZ.AbortControllerGiven;
declare var ReadableStream: new (source: any, strategy?: any) => FZ.WebReadableStream;
declare var Headers: new (init?: any) => any;
declare function setTimeout(handler: () => void, timeout?: number): unknown;
declare function queueMicrotask(callback: () => void): void;
