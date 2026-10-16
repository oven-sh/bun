/**
 * @license React
 * react-dom-server-legacy.browser.production.js
 *
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/*


 JS Implementation of MurmurHash3 (r136) (as of May 20, 2011)

 Copyright (c) 2011 Gary Court
 Permission is hereby granted, free of charge, to any person obtaining a copy
 of this software and associated documentation files (the "Software"), to deal
 in the Software without restriction, including without limitation the rights
 to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 copies of the Software, and to permit persons to whom the Software is
 furnished to do so, subject to the following conditions:

 The above copyright notice and this permission notice shall be included in
 all copies or substantial portions of the Software.

 THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 SOFTWARE.
*/
"use strict";
var React: FZ.ReactModule = require("react"),
  ReactDOM: FZ.ReactDOMModule = require("react-dom");
function formatProdErrorMessage(code: number, ...args: unknown[]): string; function formatProdErrorMessage(code: number): string {
  var url = "https://react.dev/errors/" + code;
  if (1 < arguments.length) {
    url += "?args[]=" + encodeURIComponent(arguments[1]);
    for (var i = 2; i < arguments.length; i++)
      url += "&args[]=" + encodeURIComponent(arguments[i]);
  }
  return (
    "Minified React error #" +
    code +
    "; visit " +
    url +
    " for the full message or use the non-minified dev environment for full errors and additional helpful warnings."
  );
}
var REACT_ELEMENT_TYPE = Symbol.for("react.transitional.element"),
  REACT_PORTAL_TYPE = Symbol.for("react.portal"),
  REACT_FRAGMENT_TYPE = Symbol.for("react.fragment"),
  REACT_STRICT_MODE_TYPE = Symbol.for("react.strict_mode"),
  REACT_PROFILER_TYPE = Symbol.for("react.profiler"),
  REACT_PROVIDER_TYPE = Symbol.for("react.provider"),
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
  MAYBE_ITERATOR_SYMBOL = Symbol.iterator,
  isArrayImpl = Array.isArray;
function murmurhash3_32_gc(key: string, seed: number): number {
  var remainder = key.length & 3;
  var bytes = key.length - remainder;
  var h1 = seed;
  for (seed = 0; seed < bytes; ) {
    var k1 =
      (key.charCodeAt(seed) & 255) |
      ((key.charCodeAt(++seed) & 255) << 8) |
      ((key.charCodeAt(++seed) & 255) << 16) |
      ((key.charCodeAt(++seed) & 255) << 24);
    ++seed;
    k1 =
      (3432918353 * (k1 & 65535) +
        (((3432918353 * (k1 >>> 16)) & 65535) << 16)) &
      4294967295;
    k1 = (k1 << 15) | (k1 >>> 17);
    k1 =
      (461845907 * (k1 & 65535) + (((461845907 * (k1 >>> 16)) & 65535) << 16)) &
      4294967295;
    h1 ^= k1;
    h1 = (h1 << 13) | (h1 >>> 19);
    h1 = (5 * (h1 & 65535) + (((5 * (h1 >>> 16)) & 65535) << 16)) & 4294967295;
    h1 = (h1 & 65535) + 27492 + ((((h1 >>> 16) + 58964) & 65535) << 16);
  }
  k1 = 0;
  switch (remainder) {
    case 3:
      k1 ^= (key.charCodeAt(seed + 2) & 255) << 16;
    case 2:
      k1 ^= (key.charCodeAt(seed + 1) & 255) << 8;
    case 1:
      (k1 ^= key.charCodeAt(seed) & 255),
        (k1 =
          (3432918353 * (k1 & 65535) +
            (((3432918353 * (k1 >>> 16)) & 65535) << 16)) &
          4294967295),
        (k1 = (k1 << 15) | (k1 >>> 17)),
        (h1 ^=
          (461845907 * (k1 & 65535) +
            (((461845907 * (k1 >>> 16)) & 65535) << 16)) &
          4294967295);
  }
  h1 ^= key.length;
  h1 ^= h1 >>> 16;
  h1 =
    (2246822507 * (h1 & 65535) + (((2246822507 * (h1 >>> 16)) & 65535) << 16)) &
    4294967295;
  h1 ^= h1 >>> 13;
  h1 =
    (3266489909 * (h1 & 65535) + (((3266489909 * (h1 >>> 16)) & 65535) << 16)) &
    4294967295;
  return (h1 ^ (h1 >>> 16)) >>> 0;
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
function escapeTextForBrowser(text: FZ.PropValue): string { var text$asString: string, match$asEscape: string;
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
    for (index = match.index; index < text$asString.length; index++) {
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
} as FZ.HostDispatcher;
var PRELOAD_NO_CREDS: FZ.PreloadState = [],
  scriptRegex = /(<\/|<)(s)(cript)/gi;
function scriptReplacer(match: string, prefix: string, s: string, suffix: string): string {
  return "" + prefix + ("s" === s ? "\\u0073" : "\\u0053") + suffix;
}
function createResumableState(
  identifierPrefix: FZ.PropValue,
  externalRuntimeConfig?: FZ.PropValue,
  bootstrapScriptContent?: FZ.BootstrapScriptContent,
  bootstrapScripts?: FZ.BootstrapScripts,
  bootstrapModules?: FZ.BootstrapScripts
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
  return {
    htmlChunks: null,
    headChunks: null,
    bodyChunks: null,
    contribution: 0
  };
}
function createFormatContext(insertionMode: FZ.InsertionMode, selectedValue: FZ.SelectedValue, tagScope: FZ.TagScope): FZ.FormatContext {
  return {
    insertionMode: insertionMode,
    selectedValue: selectedValue,
    tagScope: tagScope
  };
}
function getChildFormatContext(parentContext: FZ.FormatContext, type: string, props: FZ.Props): FZ.FormatContext {
  switch (type) {
    case "noscript":
      return createFormatContext(2, null, parentContext.tagScope | 1);
    case "select":
      return createFormatContext(
        2,
        null != props.value ? props.value : props.defaultValue,
        parentContext.tagScope
      );
    case "svg":
      return createFormatContext(4, null, parentContext.tagScope);
    case "picture":
      return createFormatContext(2, null, parentContext.tagScope | 2);
    case "math":
      return createFormatContext(5, null, parentContext.tagScope);
    case "foreignObject":
      return createFormatContext(2, null, parentContext.tagScope);
    case "table":
      return createFormatContext(6, null, parentContext.tagScope);
    case "thead":
    case "tbody":
    case "tfoot":
      return createFormatContext(7, null, parentContext.tagScope);
    case "colgroup":
      return createFormatContext(9, null, parentContext.tagScope);
    case "tr":
      return createFormatContext(8, null, parentContext.tagScope);
    case "head":
      if (2 > parentContext.insertionMode)
        return createFormatContext(3, null, parentContext.tagScope);
      break;
    case "html":
      if (0 === parentContext.insertionMode)
        return createFormatContext(1, null, parentContext.tagScope);
  }
  return 6 <= parentContext.insertionMode || 2 > parentContext.insertionMode
    ? createFormatContext(2, null, parentContext.tagScope)
    : parentContext;
}
var styleNameCache: Map<string, FZ.Chunk> = new Map();
function pushStyleAttribute(target: FZ.Chunk[], style: FZ.PropValue): void { var styleValue$asChunk: FZ.Chunk;
  if ("object" !== typeof style) throw Error(formatProdErrorMessage(62));
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
  if ("string" !== typeof value) throw Error(formatProdErrorMessage(480));
}
function getCustomFormFields(resumableState$given: FZ.ResumableState, formAction: FZ.FormAction): FZ.CustomFormFields { var resumableState; resumableState = resumableState$given;
  if ("function" === typeof formAction.$$FORM_ACTION) {
    var id: FZ.int32 = resumableState.nextFormID++;
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
    if (null != children) throw Error(formatProdErrorMessage(60));
    if ("object" !== typeof innerHTML || !("__html" in innerHTML))
      throw Error(formatProdErrorMessage(61));
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
  0 === (resumableState.instructions & 16) &&
    ((resumableState.instructions |= 16),
    renderState.bootstrapChunks.unshift(
      renderState.startInlineScript,
      'addEventListener("submit",function(a){if(!a.defaultPrevented){var c=a.target,d=a.submitter,e=c.action,b=d;if(d){var f=d.getAttribute("formAction");null!=f&&(e=f,b=null)}"javascript:throw new Error(\'React form unexpectedly submitted.\')"===e&&(a.preventDefault(),b?(a=document.createElement("input"),a.name=b.name,a.value=b.value,b.parentNode.insertBefore(a,b),b=new FormData(c),a.parentNode.removeChild(a)):b=new FormData(c),a=c.ownerDocument||c,(a.$$reactFormReplay=a.$$reactFormReplay||[]).push(c,d,b))}});',
      "\x3c/script>"
    ));
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
            throw Error(formatProdErrorMessage(399, "link"));
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
function pushSelfClosing(target: FZ.Chunk[], props: FZ.Props, tag: string): null {
  target.push(startChunkForTag(tag));
  for (var propKey in props)
    if (hasOwnProperty.call(props, propKey)) {
      var propValue = props[propKey];
      if (null != propValue)
        switch (propKey) {
          case "children":
          case "dangerouslySetInnerHTML":
            throw Error(formatProdErrorMessage(399, tag));
          default:
            pushAttribute(target, propKey, propValue);
        }
    }
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
function pushStartSingletonElement(target: FZ.Chunk[], props: FZ.Props, tag$given: string): FZ.ReactNode { var tag; tag = tag$given;
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
  target.push(">");
  pushInnerHTML(target, innerHTML, tag);
  return tag;
}
function pushStartGenericElement(target: FZ.Chunk[], props: FZ.Props, tag$given: string): FZ.ReactNode { var tag; tag = tag$given;
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
    if (!VALID_TAG_REGEX.test(tag))
      throw Error(formatProdErrorMessage(65, tag));
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
  textEmbedded: boolean,
  isFallback: boolean
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
                throw Error(formatProdErrorMessage(91));
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
      target$jscomp$0.push(">");
      if (null != children$jscomp$2) {
        if (null != value$jscomp$0) throw Error(formatProdErrorMessage(92));
        if (isArrayImpl(children$jscomp$2)) {
          if (1 < children$jscomp$2.length)
            throw Error(formatProdErrorMessage(93));
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
                throw Error(formatProdErrorMessage(399, "input"));
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
                throw Error(formatProdErrorMessage(400));
              default:
                pushAttribute(
                  target$jscomp$0,
                  propKey$jscomp$6,
                  propValue$jscomp$6
                );
            }
        }
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
      target$jscomp$0.push(">");
      pushInnerHTML(target$jscomp$0, innerHTML$jscomp$4, children$jscomp$5);
      if ("string" === typeof children$jscomp$5) {
        target$jscomp$0.push(escapeTextForBrowser(children$jscomp$5));
        var JSCompiler_inline_result$jscomp$2: FZ.ReactNode = null;
      } else JSCompiler_inline_result$jscomp$2 = children$jscomp$5;
      return JSCompiler_inline_result$jscomp$2;
    case "title":
      if (
        4 === formatContext.insertionMode ||
        formatContext.tagScope & 1 ||
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
      var rel: FZ.PropValue = props.rel,
        href: FZ.PropValue = props.href,
        precedence: FZ.PropValue = props.precedence;
      if (
        4 === formatContext.insertionMode ||
        formatContext.tagScope & 1 ||
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
            (JSCompiler_inline_result$jscomp$4 = isFallback
              ? null
              : pushLinkImpl(renderState.hoistableChunks, props)));
      return JSCompiler_inline_result$jscomp$4;
    case "script":
      var asyncProp: FZ.PropValue = props.async;
      if (
        "string" !== typeof props.src ||
        !props.src ||
        !asyncProp ||
        "function" === typeof asyncProp ||
        "symbol" === typeof asyncProp ||
        props.onLoad ||
        props.onError ||
        4 === formatContext.insertionMode ||
        formatContext.tagScope & 1 ||
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
      var precedence$jscomp$0: FZ.PropValue = props.precedence,
        href$jscomp$0: FZ.PropValue = props.href;
      if (
        4 === formatContext.insertionMode ||
        formatContext.tagScope & 1 ||
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
          styleQueue$jscomp$0
            ? styleQueue$jscomp$0.hrefs.push(
                escapeTextForBrowser(href$jscomp$0)
              )
            : ((styleQueue$jscomp$0 = {
                precedence: escapeTextForBrowser(precedence$jscomp$0),
                rules: [],
                hrefs: [escapeTextForBrowser(href$jscomp$0)],
                sheets: new Map()
              }),
              renderState.styles.set(precedence$jscomp$0, styleQueue$jscomp$0));
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
        styleQueue$jscomp$0 &&
          hoistableState &&
          hoistableState.styles.add(styleQueue$jscomp$0);
        textEmbedded && target$jscomp$0.push("\x3c!-- --\x3e");
        JSCompiler_inline_result$jscomp$6 = void 0;
      }
      return JSCompiler_inline_result$jscomp$6;
    case "meta":
      if (
        4 === formatContext.insertionMode ||
        formatContext.tagScope & 1 ||
        null != props.itemProp
      )
        var JSCompiler_inline_result$jscomp$7: null = pushSelfClosing(
          target$jscomp$0,
          props,
          "meta"
        );
      else
        textEmbedded && target$jscomp$0.push("\x3c!-- --\x3e"),
          (JSCompiler_inline_result$jscomp$7 = isFallback
            ? null
            : "string" === typeof props.charSet
              ? pushSelfClosing(renderState.charsetChunks, props, "meta")
              : "viewport" === props.name
                ? pushSelfClosing(renderState.viewportChunks, props, "meta")
                : pushSelfClosing(renderState.hoistableChunks, props, "meta"));
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
      target$jscomp$0.push(">");
      if (null != innerHTML$jscomp$7) {
        if (null != children$jscomp$8) throw Error(formatProdErrorMessage(60));
        if (
          "object" !== typeof innerHTML$jscomp$7 ||
          !("__html" in innerHTML$jscomp$7)
        )
          throw Error(formatProdErrorMessage(61));
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
      var src: FZ.PropValue = props.src,
        srcSet: FZ.PropValue = props.srcSet;
      if (
        !(
          "lazy" === props.loading ||
          (!src && !srcSet) ||
          ("string" !== typeof src && null != src) ||
          ("string" !== typeof srcSet && null != srcSet)
        ) &&
        "low" !== props.fetchPriority &&
        !1 === !!(formatContext.tagScope & 3) &&
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
            referrerPolicy: props.refererPolicy
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
      return pushSelfClosing(target$jscomp$0, props, "img");
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
      return pushSelfClosing(target$jscomp$0, props, type);
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
          throw Error(formatProdErrorMessage(545, "`<head>`"));
        preamble.headChunks = [];
        var JSCompiler_inline_result$jscomp$9: FZ.ReactNode = pushStartSingletonElement(
          preamble.headChunks,
          props,
          "head"
        );
      } else
        JSCompiler_inline_result$jscomp$9 = pushStartGenericElement(
          target$jscomp$0,
          props,
          "head"
        );
      return JSCompiler_inline_result$jscomp$9;
    case "body":
      if (2 > formatContext.insertionMode) {
        var preamble$jscomp$0: FZ.PreambleState = preambleState || renderState.preamble;
        if (preamble$jscomp$0.bodyChunks)
          throw Error(formatProdErrorMessage(545, "`<body>`"));
        preamble$jscomp$0.bodyChunks = [];
        var JSCompiler_inline_result$jscomp$10: FZ.ReactNode = pushStartSingletonElement(
          preamble$jscomp$0.bodyChunks,
          props,
          "body"
        );
      } else
        JSCompiler_inline_result$jscomp$10 = pushStartGenericElement(
          target$jscomp$0,
          props,
          "body"
        );
      return JSCompiler_inline_result$jscomp$10;
    case "html":
      if (0 === formatContext.insertionMode) {
        var preamble$jscomp$1: FZ.PreambleState = preambleState || renderState.preamble;
        if (preamble$jscomp$1.htmlChunks)
          throw Error(formatProdErrorMessage(545, "`<html>`"));
        preamble$jscomp$1.htmlChunks = [""];
        var JSCompiler_inline_result$jscomp$11: FZ.ReactNode = pushStartSingletonElement(
          preamble$jscomp$1.htmlChunks,
          props,
          "html"
        );
      } else
        JSCompiler_inline_result$jscomp$11 = pushStartGenericElement(
          target$jscomp$0,
          props,
          "html"
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
        target$jscomp$0.push(">");
        pushInnerHTML(target$jscomp$0, innerHTML$jscomp$8, children$jscomp$9);
        return children$jscomp$9;
      }
  }
  return pushStartGenericElement(target$jscomp$0, props, type);
}
var endTagCache: Map<string, FZ.Chunk> = new Map();
function endChunkForTag(tag: string): FZ.Chunk {
  var chunk = endTagCache.get(tag);
  void 0 === chunk && ((chunk = "</" + tag + ">"), endTagCache.set(tag, chunk));
  return chunk;
}
function hoistPreambleState(renderState$given: FZ.RenderState, preambleState: FZ.PreambleState): void { var renderState; renderState = renderState$given;
  renderState = renderState.preamble;
  null === renderState.htmlChunks &&
    preambleState.htmlChunks &&
    ((renderState.htmlChunks = preambleState.htmlChunks),
    (preambleState.contribution |= 1));
  null === renderState.headChunks &&
    preambleState.headChunks &&
    ((renderState.headChunks = preambleState.headChunks),
    (preambleState.contribution |= 4));
  null === renderState.bodyChunks &&
    preambleState.bodyChunks &&
    ((renderState.bodyChunks = preambleState.bodyChunks),
    (preambleState.contribution |= 2));
}
function writeBootstrap(destination: FZ.Destination, renderState$given: FZ.RenderState): boolean { var renderState, i$asChunk: FZ.Chunk; renderState = renderState$given;
  renderState = renderState.bootstrapChunks;
  for (var i = 0; i < renderState.length - 1; i++)
    destination.push(renderState[i]);
  return i < renderState.length
    ? ((i$asChunk = renderState[i]), (renderState.length = 0), destination.push(i$asChunk))
    : !0;
}
function writeStartPendingSuspenseBoundary(destination: FZ.Destination, renderState$given: FZ.RenderState, id: FZ.SegmentId): boolean { var renderState; renderState = renderState$given;
  destination.push('\x3c!--$?--\x3e<template id="');
  if (null === id) throw Error(formatProdErrorMessage(395));
  destination.push(renderState.boundaryPrefix);
  renderState = id.toString(16);
  destination.push(renderState);
  return destination.push('"></template>');
}
function writePreambleContribution(destination: FZ.Destination, preambleState$given: FZ.PreambleState): void { var preambleState; preambleState = preambleState$given;
  preambleState = preambleState.contribution;
  0 !== preambleState &&
    (destination.push("\x3c!--"),
    destination.push("" + preambleState),
    destination.push("--\x3e"));
}
function writeStartSegment(destination: FZ.Destination, renderState$given: FZ.RenderState, formatContext: FZ.FormatContext, id: FZ.SegmentId): boolean { var renderState; renderState = renderState$given;
  switch (formatContext.insertionMode) {
    case 0:
    case 1:
    case 3:
    case 2:
      return (
        destination.push('<div hidden id="'),
        destination.push(renderState.segmentPrefix),
        (renderState = id.toString(16)),
        destination.push(renderState),
        destination.push('">')
      );
    case 4:
      return (
        destination.push('<svg aria-hidden="true" style="display:none" id="'),
        destination.push(renderState.segmentPrefix),
        (renderState = id.toString(16)),
        destination.push(renderState),
        destination.push('">')
      );
    case 5:
      return (
        destination.push('<math aria-hidden="true" style="display:none" id="'),
        destination.push(renderState.segmentPrefix),
        (renderState = id.toString(16)),
        destination.push(renderState),
        destination.push('">')
      );
    case 6:
      return (
        destination.push('<table hidden id="'),
        destination.push(renderState.segmentPrefix),
        (renderState = id.toString(16)),
        destination.push(renderState),
        destination.push('">')
      );
    case 7:
      return (
        destination.push('<table hidden><tbody id="'),
        destination.push(renderState.segmentPrefix),
        (renderState = id.toString(16)),
        destination.push(renderState),
        destination.push('">')
      );
    case 8:
      return (
        destination.push('<table hidden><tr id="'),
        destination.push(renderState.segmentPrefix),
        (renderState = id.toString(16)),
        destination.push(renderState),
        destination.push('">')
      );
    case 9:
      return (
        destination.push('<table hidden><colgroup id="'),
        destination.push(renderState.segmentPrefix),
        (renderState = id.toString(16)),
        destination.push(renderState),
        destination.push('">')
      );
    default:
      throw Error(formatProdErrorMessage(397));
  }
}
function writeEndSegment(destination: FZ.Destination, formatContext: FZ.FormatContext): boolean {
  switch (formatContext.insertionMode) {
    case 0:
    case 1:
    case 3:
    case 2:
      return destination.push("</div>");
    case 4:
      return destination.push("</svg>");
    case 5:
      return destination.push("</math>");
    case 6:
      return destination.push("</table>");
    case 7:
      return destination.push("</tbody></table>");
    case 8:
      return destination.push("</tr></table>");
    case 9:
      return destination.push("</colgroup></table>");
    default:
      throw Error(formatProdErrorMessage(397));
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
    this.push('<style media="not all" data-precedence="');
    this.push(styleQueue.precedence);
    for (this.push('" data-href="'); i < hrefs.length - 1; i++)
      this.push(hrefs[i]), this.push(" ");
    this.push(hrefs[i]);
    this.push('">');
    for (i = 0; i < rules.length; i++) this.push(rules[i]);
    destinationHasCapacity = this.push("</style>");
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
  hoistableState.styles.forEach(flushStyleTagsLateForBoundary, destination);
  hoistableState.stylesheets.forEach(hasStylesToHoist);
  currentlyRenderingBoundaryHasStylesToHoist &&
    (renderState.stylesToHoist = !0);
  return destinationHasCapacity;
}
function flushResource(this: FZ.Destination, resource: FZ.Resource): void {
  for (var i = 0; i < resource.length; i++) this.push(resource[i]);
  resource.length = 0;
}
var stylesheetFlushingQueue: FZ.Chunk[] = [];
function flushStyleInPreamble(this: FZ.Destination, stylesheet: FZ.StylesheetResource): void {
  pushLinkImpl(stylesheetFlushingQueue, stylesheet.props);
  for (var i = 0; i < stylesheetFlushingQueue.length; i++)
    this.push(stylesheetFlushingQueue[i]);
  stylesheetFlushingQueue.length = 0;
  stylesheet.state = 2;
}
function flushStylesInPreamble(this: FZ.Destination, styleQueue$given: FZ.StyleQueue): void { var styleQueue; styleQueue = styleQueue$given;
  var hasStylesheets = 0 < styleQueue.sheets.size;
  styleQueue.sheets.forEach(flushStyleInPreamble, this);
  styleQueue.sheets.clear();
  var rules = styleQueue.rules,
    hrefs = styleQueue.hrefs;
  if (!hasStylesheets || hrefs.length) {
    this.push('<style data-precedence="');
    this.push(styleQueue.precedence);
    styleQueue = 0;
    if (hrefs.length) {
      for (
        this.push('" data-href="');
        styleQueue < hrefs.length - 1;
        styleQueue++
      )
        this.push(hrefs[styleQueue]), this.push(" ");
      this.push(hrefs[styleQueue]);
    }
    this.push('">');
    for (styleQueue = 0; styleQueue < rules.length; styleQueue++)
      this.push(rules[styleQueue]);
    this.push("</style>");
    rules.length = 0;
    hrefs.length = 0;
  }
}
function preloadLateStyle(this: FZ.Destination, stylesheet$given: FZ.StylesheetResource): void { var stylesheet; stylesheet = stylesheet$given;
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
      this.push(stylesheetFlushingQueue[stylesheet]);
    stylesheetFlushingQueue.length = 0;
  }
}
function preloadLateStyles(this: FZ.Destination, styleQueue: FZ.StyleQueue): void {
  styleQueue.sheets.forEach(preloadLateStyle, this);
  styleQueue.sheets.clear();
}
function writeStyleResourceDependenciesInJS(destination: FZ.Destination, hoistableState: FZ.HoistableState): void {
  destination.push("[");
  var nextArrayOpenBrackChunk = "[";
  hoistableState.stylesheets.forEach(function (resource) { var precedence$asString: string, resource$asHref: string;
    if (2 !== resource.state)
      if (3 === resource.state)
        destination.push(nextArrayOpenBrackChunk),
          (resource$asHref = escapeJSObjectForInstructionScripts(
            "" + resource.props.href
          )),
          destination.push(resource$asHref),
          destination.push("]"),
          (nextArrayOpenBrackChunk = ",[");
      else {
        destination.push(nextArrayOpenBrackChunk);
        var precedence = resource.props["data-precedence"],
          props = resource.props,
          coercedHref = sanitizeURL("" + resource.props.href);
        coercedHref = escapeJSObjectForInstructionScripts(coercedHref);
        destination.push(coercedHref);
        precedence$asString = "" + precedence;
        destination.push(",");
        precedence$asString = escapeJSObjectForInstructionScripts(precedence$asString);
        destination.push(precedence$asString);
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
                throw Error(formatProdErrorMessage(399, "link"));
              default:
                writeStyleResourceAttributeInJS(
                  destination,
                  propKey,
                  precedence
                );
            }
        destination.push("]");
        nextArrayOpenBrackChunk = ",[";
        resource.state = 3;
      }
  });
  destination.push("]");
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
  destination.push(",");
  attributeName = escapeJSObjectForInstructionScripts(attributeName);
  destination.push(attributeName);
  destination.push(",");
  attributeName = escapeJSObjectForInstructionScripts(name);
  destination.push(attributeName);
}
function createHoistableState(): FZ.HoistableState {
  return { styles: new Set(), stylesheets: new Set() };
}
function prefetchDNS(href: FZ.PropValue): void { var resumableState$asHeaders: FZ.PreloadHeaders | null, header$asResource: FZ.Resource;
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
function preconnect(href: FZ.PropValue, crossOrigin: FZ.PropValue): void { var resumableState$asHeaders: FZ.PreloadHeaders | null, bucket$asResource: FZ.Resource, JSCompiler_temp$asHeader: string;
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
function preload(href$given: FZ.PropValue, as: FZ.PropValue, options: FZ.Options): void { var href, resumableState$asHeaders: FZ.PreloadHeaders | null, resumableState$asResource: FZ.Resource, imageSrcSet$asResource: FZ.Resource, imageSrcSet$asDict: FZ.ResourceDict, key$asHeader: string; href = href$given;
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
function preloadModule(href: FZ.PropValue, options: FZ.Options): void { var as$asResource: FZ.Resource;
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
            var resources = resumableState.unknownResources[as];
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
function preinitStyle(href: FZ.PropValue, precedence$given: FZ.PropValue, options: FZ.Options): void { var precedence; precedence = precedence$given; var renderState$asResource: FZ.Resource | undefined;
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
        } as FZ.StylesheetResource),
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
function preinitScript(src$given: FZ.PropValue, options$given: FZ.Options): void { var src, options; src = src$given; options = options$given;
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
function preinitModuleScript(src$given: FZ.PropValue, options$given: FZ.Options): void { var src, options; src = src$given; options = options$given;
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
function getPreloadAsHeader(href$given: FZ.PropValue, as$given: FZ.PropValue, params: FZ.Options): string { var href, as; href = href$given; as = as$given;
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
function createRenderState(resumableState: FZ.ResumableState, generateStaticMarkup: boolean): FZ.RenderState {
  var idPrefix = resumableState.idPrefix,
    bootstrapChunks: FZ.Chunk[] = [],
    bootstrapScriptContent: any = resumableState.bootstrapScriptContent,
    bootstrapScripts: any = resumableState.bootstrapScripts,
    bootstrapModules: any = resumableState.bootstrapModules;
  void 0 !== bootstrapScriptContent &&
    bootstrapChunks.push(
      "<script>",
      ("" + bootstrapScriptContent).replace(scriptRegex, scriptReplacer),
      "\x3c/script>"
    );
  bootstrapScriptContent = idPrefix + "P:";
  var JSCompiler_object_inline_segmentPrefix_1542 = idPrefix + "S:";
  idPrefix += "B:";
  var JSCompiler_object_inline_preamble_1545 = createPreambleState(),
    JSCompiler_object_inline_preconnects_1555: Set<FZ.Resource> = new Set(),
    JSCompiler_object_inline_fontPreloads_1556: Set<FZ.Resource> = new Set(),
    JSCompiler_object_inline_highImagePreloads_1557: Set<FZ.Resource> = new Set(),
    JSCompiler_object_inline_styles_1558: Map<string, FZ.StyleQueue> = new Map(),
    JSCompiler_object_inline_bootstrapScripts_1559: Set<FZ.Resource> = new Set(),
    JSCompiler_object_inline_scripts_1560: Set<FZ.Resource> = new Set(),
    JSCompiler_object_inline_bulkPreloads_1561: Set<FZ.Resource> = new Set(),
    JSCompiler_object_inline_preloads_1562: FZ.PreloadMaps = {
      images: new Map(),
      stylesheets: new Map(),
      scripts: new Map(),
      moduleScripts: new Map()
    };
  if (void 0 !== bootstrapScripts)
    for (var i: any = 0; i < bootstrapScripts.length; i++) {
      var scriptConfig: any = bootstrapScripts[i],
        src: any,
        crossOrigin: any = void 0,
        integrity: any = void 0,
        props: any = {
          rel: "preload",
          as: "script",
          fetchPriority: "low",
          nonce: void 0
        };
      "string" === typeof scriptConfig
        ? (props.href = src = scriptConfig)
        : ((props.href = src = scriptConfig.src),
          (props.integrity = integrity =
            "string" === typeof scriptConfig.integrity
              ? scriptConfig.integrity
              : void 0),
          (props.crossOrigin = crossOrigin =
            "string" === typeof scriptConfig || null == scriptConfig.crossOrigin
              ? void 0
              : "use-credentials" === scriptConfig.crossOrigin
                ? "use-credentials"
                : ""));
      scriptConfig = resumableState;
      var href = src;
      scriptConfig.scriptResources[href] = null;
      scriptConfig.moduleScriptResources[href] = null;
      scriptConfig = [];
      pushLinkImpl(scriptConfig, props);
      JSCompiler_object_inline_bootstrapScripts_1559.add(scriptConfig);
      bootstrapChunks.push('<script src="', escapeTextForBrowser(src));
      "string" === typeof integrity &&
        bootstrapChunks.push('" integrity="', escapeTextForBrowser(integrity));
      "string" === typeof crossOrigin &&
        bootstrapChunks.push(
          '" crossorigin="',
          escapeTextForBrowser(crossOrigin)
        );
      bootstrapChunks.push('" async="">\x3c/script>');
    }
  if (void 0 !== bootstrapModules)
    for (
      bootstrapScripts = 0;
      bootstrapScripts < bootstrapModules.length;
      bootstrapScripts++
    )
      (props = bootstrapModules[bootstrapScripts]),
        (crossOrigin = src = void 0),
        (integrity = {
          rel: "modulepreload",
          fetchPriority: "low",
          nonce: void 0
        }),
        "string" === typeof props
          ? (integrity.href = i = props)
          : ((integrity.href = i = props.src),
            (integrity.integrity = crossOrigin =
              "string" === typeof props.integrity ? props.integrity : void 0),
            (integrity.crossOrigin = src =
              "string" === typeof props || null == props.crossOrigin
                ? void 0
                : "use-credentials" === props.crossOrigin
                  ? "use-credentials"
                  : "")),
        (props = resumableState),
        (scriptConfig = i),
        (props.scriptResources[scriptConfig] = null),
        (props.moduleScriptResources[scriptConfig] = null),
        (props = []),
        pushLinkImpl(props, integrity),
        JSCompiler_object_inline_bootstrapScripts_1559.add(props),
        bootstrapChunks.push(
          '<script type="module" src="',
          escapeTextForBrowser(i)
        ),
        "string" === typeof crossOrigin &&
          bootstrapChunks.push(
            '" integrity="',
            escapeTextForBrowser(crossOrigin)
          ),
        "string" === typeof src &&
          bootstrapChunks.push('" crossorigin="', escapeTextForBrowser(src)),
        bootstrapChunks.push('" async="">\x3c/script>');
  return {
    placeholderPrefix: bootstrapScriptContent,
    segmentPrefix: JSCompiler_object_inline_segmentPrefix_1542,
    boundaryPrefix: idPrefix,
    startInlineScript: "<script>",
    preamble: JSCompiler_object_inline_preamble_1545,
    externalRuntimeScript: null,
    bootstrapChunks: bootstrapChunks,
    importMapChunks: [],
    onHeaders: void 0,
    headers: null,
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
    preconnects: JSCompiler_object_inline_preconnects_1555,
    fontPreloads: JSCompiler_object_inline_fontPreloads_1556,
    highImagePreloads: JSCompiler_object_inline_highImagePreloads_1557,
    styles: JSCompiler_object_inline_styles_1558,
    bootstrapScripts: JSCompiler_object_inline_bootstrapScripts_1559,
    scripts: JSCompiler_object_inline_scripts_1560,
    bulkPreloads: JSCompiler_object_inline_bulkPreloads_1561,
    preloads: JSCompiler_object_inline_preloads_1562,
    stylesToHoist: !1,
    generateStaticMarkup: generateStaticMarkup
  };
}
function pushTextInstance(target$given: FZ.Chunk[], text: string, renderState: FZ.RenderState, textEmbedded: boolean): boolean { var target; target = target$given;
  if (renderState.generateStaticMarkup)
    return target.push(escapeTextForBrowser(text)), !1;
  "" === text
    ? (target = textEmbedded)
    : (textEmbedded && target.push("\x3c!-- --\x3e"),
      target.push(escapeTextForBrowser(text)),
      (target = !0));
  return target;
}
function pushSegmentFinale(target: FZ.Chunk[], renderState: FZ.RenderState, lastPushedText: boolean, textEmbedded: boolean): void {
  renderState.generateStaticMarkup ||
    (lastPushedText && textEmbedded && target.push("\x3c!-- --\x3e"));
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
  }
  if ("object" === typeof type)
    switch (type.$$typeof) {
      case REACT_PORTAL_TYPE:
        return "Portal";
      case REACT_CONTEXT_TYPE:
        return (type.displayName || "Context") + ".Provider";
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
function popToNearestCommonAncestor(prev$given: FZ.ContextNode, next: FZ.ContextNode): void { var prev; prev = prev$given;
  if (prev !== next) {
    prev.context._currentValue2 = prev.parentValue;
    prev = prev.parent;
    var parentNext = next.parent;
    if (null === prev) {
      if (null !== parentNext) throw Error(formatProdErrorMessage(401));
    } else {
      if (null === parentNext) throw Error(formatProdErrorMessage(401));
      popToNearestCommonAncestor(prev, parentNext);
    }
    next.context._currentValue2 = next.value;
  }
}
function popAllPrevious(prev$given: FZ.ContextNode): void { var prev; prev = prev$given;
  prev.context._currentValue2 = prev.parentValue;
  prev = prev.parent;
  null !== prev && popAllPrevious(prev);
}
function pushAllNext(next: FZ.ContextNode): void {
  var parentNext = next.parent;
  null !== parentNext && pushAllNext(parentNext);
  next.context._currentValue2 = next.value;
}
function popPreviousToCommonLevel(prev$given: FZ.ContextNode, next: FZ.ContextNode): void { var prev; prev = prev$given;
  prev.context._currentValue2 = prev.parentValue;
  prev = prev.parent;
  if (null === prev) throw Error(formatProdErrorMessage(402));
  prev.depth === next.depth
    ? popToNearestCommonAncestor(prev, next)
    : popPreviousToCommonLevel(prev, next);
}
function popNextToCommonLevel(prev: FZ.ContextNode, next: FZ.ContextNode): void {
  var parentNext = next.parent;
  if (null === parentNext) throw Error(formatProdErrorMessage(402));
  prev.depth === parentNext.depth
    ? popToNearestCommonAncestor(prev, parentNext)
    : popNextToCommonLevel(prev, parentNext);
  next.context._currentValue2 = next.value;
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
function pushTreeContext(baseContext$given: FZ.TreeContext, totalChildren: FZ.int32, index: FZ.int32): FZ.TreeContext { var baseContext; baseContext = baseContext$given; var length$asOverflow: string;
  var baseIdWithLeadingBit: FZ.TreeId = baseContext.id;
  baseContext = baseContext.overflow;
  var baseLength: FZ.int32 = 32 - clz32(baseIdWithLeadingBit) - 1;
  baseIdWithLeadingBit &= ~(1 << baseLength);
  index += 1;
  var length: FZ.int32 = 32 - clz32(totalChildren) + baseLength;
  if (30 < length) {
    var numberOfOverflowBits: FZ.int32 = baseLength - (baseLength % 5);
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
var SuspenseException = Error(formatProdErrorMessage(460));
function noop$2(): void {}
function trackUsedThenable(thenableState$given: FZ.ThenableState, thenable: FZ.Thenable, index$given: FZ.int32): FZ.FulfilledValue { var thenableState, index; thenableState = thenableState$given; index = index$given;
  index = thenableState[index];
  void 0 === index
    ? thenableState.push(thenable)
    : index !== thenable && (thenable.then(noop$2, noop$2), (thenable = index));
  switch (thenable.status) {
    case "fulfilled":
      return thenable.value;
    case "rejected":
      throw thenable.reason;
    default:
      "string" === typeof thenable.status
        ? thenable.then(noop$2, noop$2)
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
  if (null === suspendedThenable) throw Error(formatProdErrorMessage(459));
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
  localIdCounter: FZ.HookCounter = 0,
  actionStateCounter: FZ.HookCounter = 0,
  actionStateMatchingIndex: FZ.HookCounter = -1,
  thenableIndexCounter: FZ.HookCounter = 0,
  thenableState: FZ.ThenableState | null = null,
  renderPhaseUpdates: Map<FZ.UpdateQueue, FZ.Update> | null = null,
  numberOfReRenders: FZ.HookCounter = 0;
function resolveCurrentlyRenderingComponent(): FZ.ComponentIdentity {
  if (null === currentlyRenderingComponent)
    throw Error(formatProdErrorMessage(321));
  return currentlyRenderingComponent;
}
function createHook(): FZ.Hook {
  if (0 < numberOfReRenders) throw Error(formatProdErrorMessage(312));
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
function useReducer(reducer$given: FZ.Reducer, initialArg$given: FZ.HookState, init$given?: (initialArg: FZ.HookState) => FZ.HookState): FZ.DispatchTuple { var reducer, initialArg, init; reducer = reducer$given; initialArg = initialArg$given; init = init$given; var init$asUpdate: FZ.Update | null | undefined;
  currentlyRenderingComponent = resolveCurrentlyRenderingComponent();
  workInProgressHook = createWorkInProgressHook();
  if (isReRender) {
    var queue = workInProgressHook.queue!;var queue$asState: FZ.HookState;
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
  reducer = workInProgressHook.queue = { last: null, dispatch: null } as FZ.UpdateQueue;
  reducer = reducer.dispatch = dispatchAction.bind(
    null,
    currentlyRenderingComponent,
    reducer
  );
  return [workInProgressHook.memoizedState, reducer];
}
function useMemo(nextCreate$given: () => FZ.MemoValue, deps: FZ.HookDeps): FZ.MemoValue { var nextCreate; nextCreate = nextCreate$given;
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
function dispatchAction(componentIdentity$given: FZ.ComponentIdentity, queue$given: FZ.UpdateQueue, action$given: FZ.HookState): void { var componentIdentity: FZ.ComponentIdentity, queue: FZ.UpdateQueue, action: FZ.HookState; componentIdentity = componentIdentity$given; queue = queue$given; action = action$given; var componentIdentity$asUpdate: FZ.Update; var action$asFirst: FZ.Update | undefined; var queue$asLast: FZ.Update;
  if (25 <= numberOfReRenders) throw Error(formatProdErrorMessage(301));
  if (componentIdentity === currentlyRenderingComponent)
    if (
      ((didScheduleRenderPhaseUpdate = !0),
      (componentIdentity$asUpdate = { action: action, next: null } as FZ.Update),
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
function unsupportedStartTransition() {
  throw Error(formatProdErrorMessage(394));
}
function unsupportedSetOptimisticState() {
  throw Error(formatProdErrorMessage(479));
}
function useActionState(action: FZ.FormAction, initialState: FZ.HookState, permalink?: FZ.PropValue): FZ.ActionStateTuple { var action$asDispatch: FZ.ActionDispatch, request$asFormState: FZ.ReactFormState;
  resolveCurrentlyRenderingComponent();
  var actionStateHookIndex: FZ.HookCounter = actionStateCounter++,
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
              murmurhash3_32_gc(
                JSON.stringify([componentKeyPath, null, actionStateHookIndex]),
                0
              )),
        postbackKey === nextPostbackStateKey &&
          ((actionStateMatchingIndex = actionStateHookIndex),
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
                  murmurhash3_32_gc(
                    JSON.stringify([
                      componentKeyPath,
                      null,
                      actionStateHookIndex
                    ]),
                    0
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
  var index: FZ.HookCounter = thenableIndexCounter;
  thenableIndexCounter += 1;
  null === thenableState && (thenableState = []);
  return trackUsedThenable(thenableState, thenable, index);
}
function unsupportedRefresh() {
  throw Error(formatProdErrorMessage(393));
}
function noop$1(): void {}
var HooksDispatcher: FZ.Dispatcher = {
    readContext: function (context) {
      return context._currentValue2;
    },
    use: function (usable) {
      if (null !== usable && "object" === typeof usable) {
        if ("function" === typeof usable.then) return unwrapThenable(usable);
        if (usable.$$typeof === REACT_CONTEXT_TYPE)
          return usable._currentValue2;
      }
      throw Error(formatProdErrorMessage(438, String(usable)));
    },
    useContext: function (context) {
      resolveCurrentlyRenderingComponent();
      return context._currentValue2;
    },
    useMemo: useMemo,
    useReducer: useReducer,
    useRef: function (initialValue) { var initialValue$asRef: FZ.RefObject;
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
    useInsertionEffect: noop$1,
    useLayoutEffect: noop$1,
    useCallback: function (callback, deps) {
      return useMemo(function () {
        return callback;
      }, deps);
    },
    useImperativeHandle: noop$1,
    useEffect: noop$1,
    useDebugValue: noop$1,
    useDeferredValue: function (value, initialValue) {
      resolveCurrentlyRenderingComponent();
      return void 0 !== initialValue ? initialValue : value;
    },
    useTransition: function () {
      resolveCurrentlyRenderingComponent();
      return [!1, unsupportedStartTransition];
    },
    useId: function () { var JSCompiler_inline_result$asTreeId: FZ.TreeId, JSCompiler_inline_result$asId: string, overflow$asLocalId: FZ.HookCounter;
      var JSCompiler_inline_result = currentlyRenderingTask!.treeContext;
      var overflow = JSCompiler_inline_result.overflow;
      JSCompiler_inline_result$asTreeId = JSCompiler_inline_result.id;
      JSCompiler_inline_result$asId =
        (
          JSCompiler_inline_result$asTreeId &
          ~(1 << (32 - clz32(JSCompiler_inline_result$asTreeId) - 1))
        ).toString(32) + overflow;
      var resumableState = currentResumableState;
      if (null === resumableState) throw Error(formatProdErrorMessage(404));
      overflow$asLocalId = localIdCounter++;
      JSCompiler_inline_result$asId =
        "\u00ab" + resumableState.idPrefix + "R" + JSCompiler_inline_result$asId;
      0 < overflow$asLocalId && (JSCompiler_inline_result$asId += "H" + overflow$asLocalId.toString(32));
      return JSCompiler_inline_result$asId + "\u00bb";
    },
    useSyncExternalStore: function (subscribe, getSnapshot, getServerSnapshot) {
      if (void 0 === getServerSnapshot)
        throw Error(formatProdErrorMessage(407));
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
    }
  },
  currentResumableState: FZ.ResumableState | null = null,
  DefaultAsyncDispatcher: FZ.AsyncDispatcher = {
    getCacheForType: function () {
      throw Error(formatProdErrorMessage(248));
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
function describeNativeComponentFrame(fn: FZ.ElementType, construct: boolean): string { var RunInRootFrame$asIndex: FZ.int32, namePropDescriptor$asIndex: FZ.int32;
  if (!fn || reentry) return "";
  reentry = !0;
  var previousPrepareStackTrace = (Error as any).prepareStackTrace;
  (Error as any).prepareStackTrace = void 0;
  try {
    var RunInRootFrame: FZ.RunInRootFrame = {
      DetermineComponentFrameRoot: function () { var Fake$asResult: FZ.ReactNode;
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
                (Fake as any).call();
              } catch (x$24: FZ.Thrown) {
                control = x$24;
              }
              fn.call(Fake.prototype);
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
    if ("string" === typeof type.name)
      return (
        (payload = type.env),
        describeBuiltInComponentFrame(
          type.name + (payload ? " [" + payload + "]" : "")
        )
      );
  }
  switch (type) {
    case REACT_SUSPENSE_LIST_TYPE:
      return describeBuiltInComponentFrame("SuspenseList");
    case REACT_SUSPENSE_TYPE:
      return describeBuiltInComponentFrame("Suspense");
  }
  return "";
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
          "[%s] " + error[0],
          " " + JSCompiler_inline_result + " "
        )
      : error.splice(0, 0, "[%s] ", " " + JSCompiler_inline_result + " ");
    error.unshift(console);
    JSCompiler_inline_result = bind.apply(console.error, error);
    JSCompiler_inline_result();
  } else console.error(error);
  return null;
}
function noop(): void {}
function RequestInstance(this: FZ.Request,
  resumableState: FZ.ResumableState,
  renderState: FZ.RenderState,
  rootFormatContext: FZ.FormatContext,
  progressiveChunkSize: number | undefined,
  onError: FZ.ErrorHandler | undefined,
  onAllReady: (() => void) | undefined,
  onShellReady: (() => void) | undefined,
  onShellError: ((error: FZ.Thrown) => void) | undefined,
  onFatalError: ((error: FZ.Thrown) => void) | undefined,
  onPostpone: FZ.PostponeHandler | undefined,
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
  this.pendingRootTasks = this.allPendingTasks = this.nextSegmentId = 0;
  this.completedPreambleSegments = this.completedRootSegment = null;
  this.abortableTasks = abortSet;
  this.pingedTasks = [];
  this.clientRenderedBoundaries = [];
  this.completedBoundaries = [];
  this.partialBoundaries = [];
  this.trackedPostpones = null;
  this.onError = void 0 === onError ? defaultErrorHandler : onError;
  this.onPostpone = void 0 === onPostpone ? noop : onPostpone;
  this.onAllReady = void 0 === onAllReady ? noop : onAllReady;
  this.onShellReady = void 0 === onShellReady ? noop : onShellReady;
  this.onShellError = void 0 === onShellError ? noop : onShellError;
  this.onFatalError = void 0 === onFatalError ? noop : onFatalError;
  this.formState = void 0 === formState ? null : formState;
}
function createRequest(
  children$given: FZ.ReactNode,
  resumableState$given: FZ.ResumableState,
  renderState$given: FZ.RenderState,
  rootFormatContext: FZ.FormatContext,
  progressiveChunkSize: number | undefined,
  onError: FZ.ErrorHandler | undefined,
  onAllReady: (() => void) | undefined,
  onShellReady: (() => void) | undefined,
  onShellError: ((error: FZ.Thrown) => void) | undefined,
  onFatalError: ((error: FZ.Thrown) => void) | undefined,
  onPostpone: FZ.PostponeHandler | undefined,
  formState?: FZ.ReactFormState
): FZ.Request { var children, resumableState, renderState; children = children$given; resumableState = resumableState$given; renderState = renderState$given; var children$asTask: FZ.Task;
  resumableState = new (RequestInstance as FZ.RequestConstructor)(
    resumableState,
    renderState,
    rootFormatContext,
    progressiveChunkSize,
    onError,
    onAllReady,
    onShellReady,
    onShellError,
    onFatalError,
    onPostpone,
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
    !1
  );
  pushComponentStack(children$asTask);
  resumableState.pingedTasks.push(children$asTask);
  return resumableState;
}
var currentRequest: FZ.Request | null = null;
function pingTask(request: FZ.Request, task: FZ.Task): void {
  request.pingedTasks.push(task);
  1 === request.pingedTasks.length &&
    ((request.flushScheduled = null !== request.destination),
    performWork(request));
}
function createSuspenseBoundary(
  request: FZ.Request,
  fallbackAbortableTasks: Set<FZ.Task>,
  contentPreamble: FZ.PreambleState | null,
  fallbackPreamble: FZ.PreambleState | null
): FZ.SuspenseBoundary {
  return {
    status: 0,
    rootSegmentID: -1,
    parentFlushed: !1,
    pendingTasks: 0,
    completedSegments: [],
    byteSize: 0,
    fallbackAbortableTasks: fallbackAbortableTasks,
    errorDigest: null,
    contentState: createHoistableState(),
    fallbackState: createHoistableState(),
    contentPreamble: contentPreamble,
    fallbackPreamble: fallbackPreamble,
    trackedContentKeyPath: null,
    trackedFallbackNode: null
  };
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
  componentStack: FZ.ComponentStackNode | null,
  isFallback: boolean
): FZ.Task {
  request.allPendingTasks++;
  null === blockedBoundary
    ? request.pendingRootTasks++
    : blockedBoundary.pendingTasks++;
  var task: FZ.Task = {
    replay: null,
    node: node,
    childIndex: childIndex,
    ping: function () {
      return pingTask(request, task);
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
    componentStack: componentStack,
    thenableState: thenableState,
    isFallback: isFallback
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
  componentStack: FZ.ComponentStackNode | null,
  isFallback: boolean
): FZ.Task {
  request.allPendingTasks++;
  null === blockedBoundary
    ? request.pendingRootTasks++
    : blockedBoundary.pendingTasks++;
  replay.pendingTasks++;
  var task: FZ.Task = {
    replay: replay,
    node: node,
    childIndex: childIndex,
    ping: function () {
      return pingTask(request, task);
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
    componentStack: componentStack,
    thenableState: thenableState,
    isFallback: isFallback
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
function logRecoverableError(request$given: FZ.Request, error: FZ.Thrown, errorInfo: FZ.ThrownInfo): FZ.ErrorDigest { var request; request = request$given;
  request = request.onError;
  error = request(error, errorInfo);
  if (null == error || "string" === typeof error) return error;
}
function fatalError(request: FZ.Request, error: FZ.Thrown): void {
  var onShellError = request.onShellError,
    onFatalError = request.onFatalError;
  onShellError(error);
  onFatalError(error);
  null !== request.destination
    ? ((request.status = 14), request.destination.destroy(error))
    : ((request.status = 13), (request.fatalError = error));
}
function renderWithHooks(request$given: FZ.Request, task: FZ.Task, keyPath: FZ.KeyNode, Component: FZ.FunctionComponent, props: FZ.Props, secondArg: FZ.Ref): FZ.ReactNode { var request; request = request$given;
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
): void { var keyPath, actionStateCount; keyPath = keyPath$given; actionStateCount = actionStateCount$given; var segment$asChunks: FZ.Chunk[];
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
function renderElement(request$given: FZ.Request, task$given: FZ.Task, keyPath$given: FZ.KeyNode, type$given: FZ.ElementType, props$given: FZ.Props, ref$given: FZ.Ref): void { var request: FZ.Request, task: FZ.Task, keyPath, type, props, ref; request = request$given; task = task$given; keyPath = keyPath$given; type = type$given; props = props$given; ref = ref$given; var task$asChunks: FZ.Chunk[]; var request$asResumableState: FZ.ResumableState; var request$asSnapshot: FZ.ContextNode | null; var newProps$asContext: FZ.ContextValue; var newProps$asInstance: FZ.ClassInstance; var newProps$asSegment: FZ.Segment | null; var newProps$asChildren: FZ.ReactNode; var newProps$asKeyPath: FZ.KeyNode | null; var newProps$asFallbackKeyPath: FZ.KeyNode; var newProps$asError: FZ.Thrown; var newProps$asInit: FZ.GivenFunction; var propName$asFallback: FZ.ReactNode; var defaultProps$asContextType: FZ.ReactContext; var defaultProps$asInternals: FZ.InternalInstance; var defaultProps$asState: FZ.ClassState; var defaultProps$asFormatContext: FZ.FormatContext; var defaultProps$asNode: FZ.ReplayNode; var defaultProps$asInfo: FZ.ThrownInfo; var defaultProps$asChildren: FZ.ReactNode; var propName$33$asPartial: FZ.ClassState; var propName$33$asSegment: FZ.Segment; var initialState$asDontMutate: boolean; var initialState$asKeyPath: FZ.KeyNode | null; var initialState$asDigest: FZ.ErrorDigest; var initialState$asValue: FZ.ContextValue; var newBoundary$asKey: string; var ref$asIndex: FZ.int32;
  if ("function" === typeof type)
    if (type.prototype && type.prototype.isReactComponent) {
      var newProps: FZ.PropsBag = props;
      if ("ref" in props) {
        newProps = {};
        for (var propName in props)
          "ref" !== propName && (newProps[propName] = props[propName]);
      }
      var defaultProps: FZ.Props = type.defaultProps;
      if (defaultProps) {
        newProps === props && (newProps = assign({}, newProps, props));
        for (var propName$33 in defaultProps)
          void 0 === newProps[propName$33] &&
            (newProps[propName$33] = defaultProps[propName$33]);
      }
      props = newProps;
      newProps$asContext = emptyContextObject;
      defaultProps$asContextType = type.contextType;
      "object" === typeof defaultProps$asContextType &&
        null !== defaultProps$asContextType &&
        (newProps$asContext = defaultProps$asContextType._currentValue2);
      newProps$asInstance = new type(props, newProps$asContext);
      var initialState: FZ.ClassState = void 0 !== newProps$asInstance.state ? newProps$asInstance.state : null;
      newProps$asInstance.updater = classComponentUpdater;
      newProps$asInstance.props = props;
      newProps$asInstance.state = initialState;
      defaultProps$asInternals = { queue: [], replace: !1 };
      newProps$asInstance._reactInternals = defaultProps$asInternals;
      ref = type.contextType;
      newProps$asInstance.context =
        "object" === typeof ref && null !== ref
          ? ref._currentValue2
          : emptyContextObject;
      ref = type.getDerivedStateFromProps;
      "function" === typeof ref &&
        ((ref = ref(props, initialState)),
        (initialState =
          null === ref || void 0 === ref
            ? initialState
            : assign({}, initialState, ref)),
        (newProps$asInstance.state = initialState));
      if (
        "function" !== typeof type.getDerivedStateFromProps &&
        "function" !== typeof newProps$asInstance.getSnapshotBeforeUpdate &&
        ("function" === typeof newProps$asInstance.UNSAFE_componentWillMount ||
          "function" === typeof newProps$asInstance.componentWillMount)
      )
        if (
          ((type = newProps$asInstance.state),
          "function" === typeof newProps$asInstance.componentWillMount &&
            newProps$asInstance.componentWillMount(),
          "function" === typeof newProps$asInstance.UNSAFE_componentWillMount &&
            newProps$asInstance.UNSAFE_componentWillMount(),
          type !== newProps$asInstance.state &&
            classComponentUpdater.enqueueReplaceState(
              newProps$asInstance,
              newProps$asInstance.state,
              null
            ),
          null !== defaultProps$asInternals.queue && 0 < defaultProps$asInternals.queue.length)
        )
          if (
            ((type = defaultProps$asInternals.queue!),
            (ref = defaultProps$asInternals.replace),
            (defaultProps$asInternals.queue = null),
            (defaultProps$asInternals.replace = !1),
            ref && 1 === type.length)
          )
            newProps$asInstance.state = type[0];
          else {
            defaultProps$asState = ref ? type[0] : newProps$asInstance.state;
            initialState$asDontMutate = !0;
            for (ref$asIndex = ref ? 1 : 0; ref$asIndex < type.length; ref$asIndex++)
              (propName$33$asPartial = type[ref$asIndex]),
                (propName$33$asPartial =
                  "function" === typeof propName$33$asPartial
                    ? propName$33$asPartial.call(newProps$asInstance, defaultProps$asState, props, void 0)
                    : propName$33$asPartial),
                null != propName$33$asPartial &&
                  (initialState$asDontMutate
                    ? ((initialState$asDontMutate = !1),
                      (defaultProps$asState = assign({}, defaultProps$asState, propName$33$asPartial)))
                    : assign(defaultProps$asState, propName$33$asPartial));
            newProps$asInstance.state = defaultProps$asState;
          }
        else defaultProps$asInternals.queue = null;
      type = newProps$asInstance.render();
      if (12 === request.status) throw null;
      props = task.keyPath;
      task.keyPath = keyPath;
      renderNodeDestructive(request, task, type, -1);
      task.keyPath = props;
    } else {
      type = renderWithHooks(request, task, keyPath, type, props, void 0);
      if (12 === request.status) throw null;
      finishFunctionComponent(
        request,
        task,
        keyPath,
        type,
        0 !== localIdCounter,
        actionStateCounter,
        actionStateMatchingIndex
      );
    }
  else if ("string" === typeof type)
    if (((newProps$asSegment = task.blockedSegment), null === newProps$asSegment))
      (newProps$asChildren = props.children),
        (defaultProps$asFormatContext = task.formatContext),
        (initialState$asKeyPath = task.keyPath),
        (task.formatContext = getChildFormatContext(defaultProps$asFormatContext, type, props)),
        (task.keyPath = keyPath),
        renderNode(request, task, newProps$asChildren, -1),
        (task.formatContext = defaultProps$asFormatContext),
        (task.keyPath = initialState$asKeyPath);
    else {
      ref = pushStartInstance(
        newProps$asSegment.chunks,
        type,
        props,
        request.resumableState,
        request.renderState,
        task.blockedPreamble,
        task.hoistableState,
        task.formatContext,
        newProps$asSegment.lastPushedText,
        task.isFallback
      );
      newProps$asSegment.lastPushedText = !1;
      defaultProps$asFormatContext = task.formatContext;
      initialState$asKeyPath = task.keyPath;
      task.keyPath = keyPath;
      3 ===
      (task.formatContext = getChildFormatContext(defaultProps$asFormatContext, type, props))
        .insertionMode
        ? ((keyPath = createPendingSegment(
            request,
            0,
            null,
            task.formatContext,
            !1,
            !1
          )),
          newProps$asSegment.preambleChildren.push(keyPath),
          (keyPath = createRenderTask(
            request,
            null,
            ref,
            -1,
            task.blockedBoundary,
            keyPath,
            task.blockedPreamble,
            task.hoistableState,
            request.abortableTasks,
            task.keyPath,
            task.formatContext,
            task.context,
            task.treeContext,
            task.componentStack,
            task.isFallback
          )),
          pushComponentStack(keyPath),
          request.pingedTasks.push(keyPath))
        : renderNode(request, task, ref, -1);
      task.formatContext = defaultProps$asFormatContext;
      task.keyPath = initialState$asKeyPath;
      a: {
        task$asChunks = newProps$asSegment.chunks;
        request$asResumableState = request.resumableState;
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
            if (1 >= defaultProps$asFormatContext.insertionMode) {
              request$asResumableState.hasBody = !0;
              break a;
            }
            break;
          case "html":
            if (0 === defaultProps$asFormatContext.insertionMode) {
              request$asResumableState.hasHtml = !0;
              break a;
            }
            break;
          case "head":
            if (1 >= defaultProps$asFormatContext.insertionMode) break a;
        }
        task$asChunks.push(endChunkForTag(type));
      }
      newProps$asSegment.lastPushedText = !1;
    }
  else {
    switch (type) {
      case REACT_LEGACY_HIDDEN_TYPE:
      case REACT_STRICT_MODE_TYPE:
      case REACT_PROFILER_TYPE:
      case REACT_FRAGMENT_TYPE:
        type = task.keyPath;
        task.keyPath = keyPath;
        renderNodeDestructive(request, task, props.children, -1);
        task.keyPath = type;
        return;
      case REACT_ACTIVITY_TYPE:
        "hidden" !== props.mode &&
          ((type = task.keyPath),
          (task.keyPath = keyPath),
          renderNodeDestructive(request, task, props.children, -1),
          (task.keyPath = type));
        return;
      case REACT_SUSPENSE_LIST_TYPE:
        type = task.keyPath;
        task.keyPath = keyPath;
        renderNodeDestructive(request, task, props.children, -1);
        task.keyPath = type;
        return;
      case REACT_VIEW_TRANSITION_TYPE:
      case REACT_SCOPE_TYPE:
        throw Error(formatProdErrorMessage(343));
      case REACT_SUSPENSE_TYPE:
        a: if (null !== task.replay) {
          type = task.keyPath;
          task.keyPath = keyPath;
          keyPath = props.children;
          try {
            renderNode(request, task, keyPath, -1);
          } finally {
            task.keyPath = type;
          }
        } else {
          type = task.keyPath;
          var parentBoundary = task.blockedBoundary;
          ref = task.blockedPreamble;
          var parentHoistableState = task.hoistableState;
          propName$33$asSegment = task.blockedSegment!;
          propName$asFallback = props.fallback;
          props = props.children;
          var fallbackAbortSet = new Set<FZ.Task>();
          var newBoundary =
            2 > task.formatContext.insertionMode
              ? createSuspenseBoundary(
                  request,
                  fallbackAbortSet,
                  createPreambleState(),
                  createPreambleState()
                )
              : createSuspenseBoundary(request, fallbackAbortSet, null, null);
          null !== request.trackedPostpones &&
            (newBoundary.trackedContentKeyPath = keyPath);
          var boundarySegment = createPendingSegment(
            request,
            propName$33$asSegment.chunks.length,
            newBoundary,
            task.formatContext,
            !1,
            !1
          );
          propName$33$asSegment.children.push(boundarySegment);
          propName$33$asSegment.lastPushedText = !1;
          var contentRootSegment = createPendingSegment(
            request,
            0,
            null,
            task.formatContext,
            !1,
            !1
          );
          contentRootSegment.parentFlushed = !0;
          if (null !== request.trackedPostpones) {
            newProps$asFallbackKeyPath = [keyPath[0], "Suspense Fallback", keyPath[2]];
            defaultProps$asNode = [newProps$asFallbackKeyPath[1], newProps$asFallbackKeyPath[2], [], null];
            request.trackedPostpones.workingMap.set(newProps$asFallbackKeyPath, defaultProps$asNode);
            newBoundary.trackedFallbackNode = defaultProps$asNode;
            task.blockedSegment = boundarySegment;
            task.blockedPreamble = newBoundary.fallbackPreamble;
            task.keyPath = newProps$asFallbackKeyPath;
            boundarySegment.status = 6;
            try {
              renderNode(request, task, propName$asFallback, -1),
                pushSegmentFinale(
                  boundarySegment.chunks,
                  request.renderState,
                  boundarySegment.lastPushedText,
                  boundarySegment.textEmbedded
                ),
                (boundarySegment.status = 1);
            } catch (thrownValue: FZ.Thrown) {
              throw (
                ((boundarySegment.status = 12 === request.status ? 3 : 4),
                thrownValue)
              );
            } finally {
              (task.blockedSegment = propName$33$asSegment),
                (task.blockedPreamble = ref),
                (task.keyPath = type);
            }
            task = createRenderTask(
              request,
              null,
              props,
              -1,
              newBoundary,
              contentRootSegment,
              newBoundary.contentPreamble,
              newBoundary.contentState,
              task.abortSet,
              keyPath,
              task.formatContext,
              task.context,
              task.treeContext,
              task.componentStack,
              task.isFallback
            );
            pushComponentStack(task);
            request.pingedTasks.push(task);
          } else {
            task.blockedBoundary = newBoundary;
            task.blockedPreamble = newBoundary.contentPreamble;
            task.hoistableState = newBoundary.contentState;
            task.blockedSegment = contentRootSegment;
            task.keyPath = keyPath;
            contentRootSegment.status = 6;
            try {
              if (
                (renderNode(request, task, props, -1),
                pushSegmentFinale(
                  contentRootSegment.chunks,
                  request.renderState,
                  contentRootSegment.lastPushedText,
                  contentRootSegment.textEmbedded
                ),
                (contentRootSegment.status = 1),
                queueCompletedSegment(newBoundary, contentRootSegment),
                0 === newBoundary.pendingTasks && 0 === newBoundary.status)
              ) {
                newBoundary.status = 1;
                0 === request.pendingRootTasks &&
                  task.blockedPreamble &&
                  preparePreamble(request);
                break a;
              }
            } catch (thrownValue$28: FZ.Thrown) {
              (newBoundary.status = 4),
                12 === request.status
                  ? ((contentRootSegment.status = 3),
                    (newProps$asError = request.fatalError))
                  : ((contentRootSegment.status = 4),
                    (newProps$asError = thrownValue$28)),
                (defaultProps$asInfo = getThrownInfo(task.componentStack)),
                (initialState$asDigest = logRecoverableError(
                  request,
                  newProps$asError,
                  defaultProps$asInfo
                )),
                (newBoundary.errorDigest = initialState$asDigest),
                untrackBoundary(request, newBoundary);
            } finally {
              (task.blockedBoundary = parentBoundary),
                (task.blockedPreamble = ref),
                (task.hoistableState = parentHoistableState),
                (task.blockedSegment = propName$33$asSegment),
                (task.keyPath = type);
            }
            task = createRenderTask(
              request,
              null,
              propName$asFallback,
              -1,
              parentBoundary,
              boundarySegment,
              newBoundary.fallbackPreamble,
              newBoundary.fallbackState,
              fallbackAbortSet,
              [keyPath[0], "Suspense Fallback", keyPath[2]],
              task.formatContext,
              task.context,
              task.treeContext,
              task.componentStack,
              !0
            );
            pushComponentStack(task);
            request.pingedTasks.push(task);
          }
        }
        return;
    }
    if ("object" === typeof type && null !== type)
      switch (type.$$typeof) {
        case REACT_FORWARD_REF_TYPE:
          if ("ref" in props)
            for (newBoundary$asKey in ((newProps = {}), props))
              "ref" !== newBoundary$asKey &&
                (newProps[newBoundary$asKey] = props[newBoundary$asKey]);
          else newProps = props;
          type = renderWithHooks(
            request,
            task,
            keyPath,
            type.render,
            newProps,
            ref
          );
          finishFunctionComponent(
            request,
            task,
            keyPath,
            type,
            0 !== localIdCounter,
            actionStateCounter,
            actionStateMatchingIndex
          );
          return;
        case REACT_MEMO_TYPE:
          renderElement(request, task, keyPath, type.type, props, ref);
          return;
        case REACT_PROVIDER_TYPE:
        case REACT_CONTEXT_TYPE:
          defaultProps$asChildren = props.children;
          newProps$asKeyPath = task.keyPath;
          props = props.value;
          initialState$asValue = type._currentValue2;
          type._currentValue2 = props;
          ref = currentActiveSnapshot;
          currentActiveSnapshot = type = {
            parent: ref,
            depth: null === ref ? 0 : ref.depth + 1,
            context: type,
            parentValue: initialState$asValue,
            value: props
          } as FZ.ContextNode;
          task.context = type;
          task.keyPath = keyPath;
          renderNodeDestructive(request, task, defaultProps$asChildren, -1);
          request$asSnapshot = currentActiveSnapshot;
          if (null === request$asSnapshot) throw Error(formatProdErrorMessage(403));
          request$asSnapshot.context._currentValue2 = request$asSnapshot.parentValue;
          request$asSnapshot = currentActiveSnapshot = request$asSnapshot.parent;
          task.context = request$asSnapshot;
          task.keyPath = newProps$asKeyPath;
          return;
        case REACT_CONSUMER_TYPE:
          props = props.children;
          type = props(type._context._currentValue2);
          props = task.keyPath;
          task.keyPath = keyPath;
          renderNodeDestructive(request, task, type, -1);
          task.keyPath = props;
          return;
        case REACT_LAZY_TYPE:
          newProps$asInit = type._init;
          type = newProps$asInit(type._payload);
          if (12 === request.status) throw null;
          renderElement(request, task, keyPath, type, props, ref);
          return;
      }
    throw Error(
      formatProdErrorMessage(130, null == type ? type : typeof type, "")
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
      null === blockedBoundary
        ? (request.completedRootSegment = resumedSegment)
        : (queueCompletedSegment(blockedBoundary, resumedSegment),
          blockedBoundary.parentFlushed &&
            request.partialBoundaries.push(blockedBoundary));
  } finally {
    (task.replay = prevReplay), (task.blockedSegment = null);
  }
}
function renderNodeDestructive(request: FZ.Request, task: FZ.Task, node$given: FZ.ReactNode, childIndex: FZ.ChildIndex): void { var node; node = node$given;
  null !== task.replay && "number" === typeof task.replay.slots
    ? resumeNode(request, task, task.replay.slots, node, childIndex)
    : ((task.node = node),
      (task.childIndex = childIndex),
      (node = task.componentStack),
      pushComponentStack(task),
      retryNode(request, task),
      (task.componentStack = node));
}
function retryNode(request: FZ.Request, task: FZ.Task): void { var node$asIndex: FZ.int32; var childIndex$asNodes: FZ.ReplayNode[]; var childIndex$asString: string; var childIndex$asSegment: FZ.Segment | null; var type$asThrown: FZ.Thrown; var type$asId: FZ.SegmentId; var key$asKeyPath: FZ.KeyNode; var key$asBoundary: FZ.SuspenseBoundary | null; var props$asInfo: FZ.ThrownInfo; var props$asDigest: FZ.ErrorDigest; var props$asBoundary: FZ.SuspenseBoundary; var props$asChildren: FZ.ReactNode[]; var ref$asNodes: FZ.ReplayNode[]; var name$asSlots: FZ.ResumeSlots; var keyOrIndex$asNode: FZ.ReactNode; var keyOrIndex$asNodes: FZ.ReplayNode[]; var replay$asDigest: FZ.ErrorDigest; var node$jscomp$0$asSlots: FZ.ResumeSlots; var childNodes$asInfo: FZ.ThrownInfo; var childNodes$asInit: FZ.GivenFunction; var childNodes$asIterator: FZ.IteratorFn;
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
              null == key ? (-1 === childIndex ? 0 : childIndex) : key;
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
                        formatProdErrorMessage(490, node$jscomp$0[0], name)
                      );
                    var childNodes: FZ.ReplayNode[] = node$jscomp$0[2];
                    name$asSlots = node$jscomp$0[3];
                    keyOrIndex$asNode = task.node;
                    task.replay = {
                      nodes: childNodes,
                      slots: name$asSlots,
                      pendingTasks: 1
                    };
                    try {
                      renderElement(request, task, key$asKeyPath, type, props, ref);
                      if (
                        1 === task.replay.pendingTasks &&
                        0 < task.replay.nodes.length
                      )
                        throw Error(formatProdErrorMessage(488));
                      task.replay.pendingTasks--;
                    } catch (x: FZ.Thrown) {
                      if (
                        "object" === typeof x &&
                        null !== x &&
                        (x === SuspenseException ||
                          "function" === typeof x.then)
                      )
                        throw (
                          (task.node === keyOrIndex$asNode && (task.replay = replay),
                          x)
                        );
                      task.replay.pendingTasks--;
                      props$asInfo = getThrownInfo(task.componentStack);
                      key$asBoundary = task.blockedBoundary;
                      type$asThrown = x;
                      props$asDigest = logRecoverableError(request, type$asThrown, props$asInfo);
                      abortRemainingReplayNodes(
                        request,
                        key$asBoundary,
                        childNodes,
                        name$asSlots,
                        type$asThrown,
                        props$asDigest
                      );
                    }
                    task.replay = replay;
                  } else {
                    if (type !== REACT_SUSPENSE_TYPE)
                      throw Error(
                        formatProdErrorMessage(
                          490,
                          "Suspense",
                          getComponentNameFromType(type) || "Unknown"
                        )
                      );
                    b: {
                      replay$asDigest = void 0;
                      type$asId = node$jscomp$0[5]!;
                      ref$asNodes = node$jscomp$0[2];
                      name$asSlots = node$jscomp$0[3];
                      keyOrIndex$asNodes =
                        null === node$jscomp$0[4] ? [] : node$jscomp$0[4]![2];
                      node$jscomp$0$asSlots =
                        null === node$jscomp$0[4] ? null : node$jscomp$0[4]![3];
                      var prevKeyPath = task.keyPath,
                        previousReplaySet = task.replay,
                        parentBoundary = task.blockedBoundary,
                        parentHoistableState = task.hoistableState,
                        content: FZ.ReactNode = props.children,
                        fallback: FZ.ReactNode = props.fallback,
                        fallbackAbortSet = new Set<FZ.Task>();
                      props$asBoundary =
                        2 > task.formatContext.insertionMode
                          ? createSuspenseBoundary(
                              request,
                              fallbackAbortSet,
                              createPreambleState(),
                              createPreambleState()
                            )
                          : createSuspenseBoundary(
                              request,
                              fallbackAbortSet,
                              null,
                              null
                            );
                      props$asBoundary.parentFlushed = !0;
                      props$asBoundary.rootSegmentID = type$asId;
                      task.blockedBoundary = props$asBoundary;
                      task.hoistableState = props$asBoundary.contentState;
                      task.keyPath = key$asKeyPath;
                      task.replay = {
                        nodes: ref$asNodes,
                        slots: name$asSlots,
                        pendingTasks: 1
                      };
                      try {
                        renderNode(request, task, content, -1);
                        if (
                          1 === task.replay.pendingTasks &&
                          0 < task.replay.nodes.length
                        )
                          throw Error(formatProdErrorMessage(488));
                        task.replay.pendingTasks--;
                        if (0 === props$asBoundary.pendingTasks && 0 === props$asBoundary.status) {
                          props$asBoundary.status = 1;
                          request.completedBoundaries.push(props$asBoundary);
                          break b;
                        }
                      } catch (error: FZ.Thrown) {
                        (props$asBoundary.status = 4),
                          (childNodes$asInfo = getThrownInfo(task.componentStack)),
                          (replay$asDigest = logRecoverableError(
                            request,
                            error,
                            childNodes$asInfo
                          )),
                          (props$asBoundary.errorDigest = replay$asDigest),
                          task.replay.pendingTasks--,
                          request.clientRenderedBoundaries.push(props$asBoundary);
                      } finally {
                        (task.blockedBoundary = parentBoundary),
                          (task.hoistableState = parentHoistableState),
                          (task.replay = previousReplaySet),
                          (task.keyPath = prevKeyPath);
                      }
                      task = createReplayTask(
                        request,
                        null,
                        {
                          nodes: keyOrIndex$asNodes,
                          slots: node$jscomp$0$asSlots,
                          pendingTasks: 0
                        } as FZ.ReplaySet,
                        fallback,
                        -1,
                        parentBoundary,
                        props$asBoundary.fallbackState,
                        fallbackAbortSet,
                        [key$asKeyPath[0], "Suspense Fallback", key$asKeyPath[2]],
                        task.formatContext,
                        task.context,
                        task.treeContext,
                        task.componentStack,
                        !0
                      );
                      pushComponentStack(task);
                      request.pingedTasks.push(task);
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
          throw Error(formatProdErrorMessage(257));
        case REACT_LAZY_TYPE:
          childNodes$asInit = node._init;
          node = childNodes$asInit(node._payload);
          if (12 === request.status) throw null;
          renderNodeDestructive(request, task, node, childIndex);
          return;
      }
      if (isArrayImpl(node)) {
        renderChildrenArray(request, task, node, childIndex);
        return;
      }
      null === node || "object" !== typeof node
        ? (childNodes$asIterator = null)
        : ((childNodes$asIterator =
            (MAYBE_ITERATOR_SYMBOL && node[MAYBE_ITERATOR_SYMBOL]) ||
            node["@@iterator"]),
          (childNodes$asIterator = "function" === typeof childNodes$asIterator ? childNodes$asIterator : null));
      if (childNodes$asIterator && (childNodes$asIterator = childNodes$asIterator.call(node))) {
        node = childNodes$asIterator.next();
        if (!node.done) {
          props$asChildren = [];
          do props$asChildren.push(node.value), (node = childNodes$asIterator.next());
          while (!node.done);
          renderChildrenArray(request, task, props$asChildren, childIndex);
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
          node._currentValue2,
          childIndex
        );
      childIndex$asString = Object.prototype.toString.call(node);
      throw Error(
        formatProdErrorMessage(
          31,
          "[object Object]" === childIndex$asString
            ? "object with keys {" + Object.keys(node).join(", ") + "}"
            : childIndex$asString
        )
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
function renderChildrenArray(request: FZ.Request, task: FZ.Task, children$given: FZ.ReactNode[], childIndex$given: FZ.ChildIndex): void { var children, childIndex; children = children$given; childIndex = childIndex$given; var replay$asTreeContext: FZ.TreeContext; var replayNodes$asLength: FZ.int32; var j$asSlots: FZ.ResumeSlots; var node$asSlots: FZ.ResumeSlots; var node$asChild: FZ.ReactNode; var boundary$asId: FZ.SegmentId | undefined;
  var prevKeyPath = task.keyPath;
  if (
    -1 !== childIndex &&
    ((task.keyPath = [task.keyPath, "Fragment", childIndex]),
    null !== task.replay)
  ) {
    for (
      var replay: FZ.ReplaySet = task.replay, replayNodes: FZ.ReplayNode[] = replay.nodes, j: FZ.int32 = 0;
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
            throw Error(formatProdErrorMessage(488));
          task.replay.pendingTasks--;
        } catch (x: FZ.Thrown) {
          if (
            "object" === typeof x &&
            null !== x &&
            (x === SuspenseException || "function" === typeof x.then)
          )
            throw x;
          task.replay.pendingTasks--;
          children = getThrownInfo(task.componentStack);
          var boundary = task.blockedBoundary,
            error: FZ.Thrown = x;
          children = logRecoverableError(request, error, children);
          abortRemainingReplayNodes(
            request,
            boundary,
            childIndex,
            node$asSlots,
            error,
            children
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
  replayNodes$asLength = children.length;
  if (
    null !== task.replay &&
    ((j$asSlots = task.replay.slots), null !== j$asSlots && "object" === typeof j$asSlots)
  ) {
    for (childIndex = 0; childIndex < replayNodes$asLength; childIndex++)
      (node$asChild = children[childIndex]),
        (task.treeContext = pushTreeContext(replay$asTreeContext, replayNodes$asLength, childIndex)),
        (boundary$asId = (j$asSlots as FZ.SlotMap)[childIndex]),
        "number" === typeof boundary$asId
          ? (resumeNode(request, task, boundary$asId, node$asChild, childIndex),
            delete (j$asSlots as FZ.SlotMap)[childIndex])
          : renderNode(request, task, node$asChild, childIndex);
    task.treeContext = replay$asTreeContext;
    task.keyPath = prevKeyPath;
    return;
  }
  for (j = 0; j < replayNodes$asLength; j++)
    (childIndex = children[j]),
      (task.treeContext = pushTreeContext(replay$asTreeContext, replayNodes$asLength, j)),
      renderNode(request, task, childIndex, j);
  task.treeContext = replay$asTreeContext;
  task.keyPath = prevKeyPath;
}
function untrackBoundary(request$given: FZ.Request, boundary$given: FZ.SuspenseBoundary): void { var request, boundary; request = request$given; boundary = boundary$given;
  request = request.trackedPostpones;
  null !== request &&
    ((boundary = boundary.trackedContentKeyPath),
    null !== boundary &&
      ((boundary = request.workingMap.get(boundary)),
      void 0 !== boundary &&
        ((boundary.length = 4), (boundary[2] = []), (boundary[3] = null))));
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
    task.componentStack,
    task.isFallback
  );
}
function spawnNewSuspendedRenderTask(request: FZ.Request, task: FZ.Task, thenableState: FZ.ThenableState | null): FZ.Task {
  var segment = task.blockedSegment!,
    newSegment = createPendingSegment(
      request,
      segment.chunks.length,
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
    task.componentStack,
    task.isFallback
  );
}
function renderNode(request$given: FZ.Request, task: FZ.Task, node$given: FZ.ReactNode, childIndex$given: FZ.ChildIndex): void { var request, node, childIndex; request = request$given; node = node$given; childIndex = childIndex$given;
  var previousFormatContext = task.formatContext,
    previousContext = task.context,
    previousKeyPath = task.keyPath,
    previousTreeContext = task.treeContext,
    previousComponentStack = task.componentStack,
    segment = task.blockedSegment;
  if (null === segment)
    try {
      return renderNodeDestructive(request, task, node, childIndex);
    } catch (thrownValue: FZ.Thrown) {
      if (
        (resetHooksState(),
        (node =
          thrownValue === SuspenseException
            ? getSuspendedThenable()
            : thrownValue),
        "object" === typeof node && null !== node)
      ) {
        if ("function" === typeof node.then) {
          childIndex = getThenableStateAfterSuspending();
          request = spawnNewSuspendedReplayTask(request, task, childIndex).ping;
          node.then(request, request);
          task.formatContext = previousFormatContext;
          task.context = previousContext;
          task.keyPath = previousKeyPath;
          task.treeContext = previousTreeContext;
          task.componentStack = previousComponentStack;
          switchContext(previousContext);
          return;
        }
        if ("Maximum call stack size exceeded" === node.message) {
          node = getThenableStateAfterSuspending();
          node = spawnNewSuspendedReplayTask(request, task, node);
          request.pingedTasks.push(node);
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
  else {
    var childrenLength = segment.children.length,
      chunkLength = segment.chunks.length;
    try {
      return renderNodeDestructive(request, task, node, childIndex);
    } catch (thrownValue$48: FZ.Thrown) {
      if (
        (resetHooksState(),
        (segment.children.length = childrenLength),
        (segment.chunks.length = chunkLength),
        (node =
          thrownValue$48 === SuspenseException
            ? getSuspendedThenable()
            : thrownValue$48),
        "object" === typeof node && null !== node)
      ) {
        if ("function" === typeof node.then) {
          childIndex = getThenableStateAfterSuspending();
          request = spawnNewSuspendedRenderTask(request, task, childIndex).ping;
          node.then(request, request);
          task.formatContext = previousFormatContext;
          task.context = previousContext;
          task.keyPath = previousKeyPath;
          task.treeContext = previousTreeContext;
          task.componentStack = previousComponentStack;
          switchContext(previousContext);
          return;
        }
        if ("Maximum call stack size exceeded" === node.message) {
          node = getThenableStateAfterSuspending();
          node = spawnNewSuspendedRenderTask(request, task, node);
          request.pingedTasks.push(node);
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
function abortTaskSoft(this: FZ.Request, task$given: FZ.Task): void { var task; task = task$given;
  var boundary = task.blockedBoundary;
  task = task.blockedSegment;
  null !== task && ((task.status = 3), finishedTask(this, boundary, task));
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
          new Set(),
          null,
          null
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
    if (null === boundary) throw Error(formatProdErrorMessage(487));
    4 !== boundary.status &&
      ((boundary.status = 4),
      (boundary.errorDigest = errorDigest$jscomp$0),
      boundary.parentFlushed &&
        request$jscomp$0.clientRenderedBoundaries.push(boundary));
    if ("object" === typeof slots) for (var index in slots) delete slots[index];
  }
}
function abortTask(task$given: FZ.Task, request: FZ.Request, error: FZ.Thrown): void { var task; task = task$given; var boundary$asReplay: FZ.ReplaySet | null, segment$asInfo: FZ.ThrownInfo;
  var boundary = task.blockedBoundary,
    segment = task.blockedSegment;
  if (null !== segment) {
    if (6 === segment.status) return;
    segment.status = 3;
  }
  segment$asInfo = getThrownInfo(task.componentStack);
  if (null === boundary) {
    if (13 !== request.status && 14 !== request.status) {
      boundary$asReplay = task.replay;
      if (null === boundary$asReplay) {
        logRecoverableError(request, error, segment$asInfo);
        fatalError(request, error);
        return;
      }
      boundary$asReplay.pendingTasks--;
      0 === boundary$asReplay.pendingTasks &&
        0 < boundary$asReplay.nodes.length &&
        ((task = logRecoverableError(request, error, segment$asInfo)),
        abortRemainingReplayNodes(
          request,
          null,
          boundary$asReplay.nodes,
          boundary$asReplay.slots,
          error,
          task
        ));
      request.pendingRootTasks--;
      0 === request.pendingRootTasks && completeShell(request);
    }
  } else
    boundary.pendingTasks--,
      4 !== boundary.status &&
        ((boundary.status = 4),
        (task = logRecoverableError(request, error, segment$asInfo)),
        (boundary.status = 4),
        (boundary.errorDigest = task),
        untrackBoundary(request, boundary),
        boundary.parentFlushed &&
          request.clientRenderedBoundaries.push(boundary)),
      boundary.fallbackAbortableTasks.forEach(function (fallbackTask) {
        return abortTask(fallbackTask, request, error);
      }),
      boundary.fallbackAbortableTasks.clear();
  request.allPendingTasks--;
  0 === request.allPendingTasks && completeAll(request);
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
function completeShell(request$given: FZ.Request): void { var request; request = request$given;
  null === request.trackedPostpones && safelyEmitEarlyPreloads(request, !0);
  null === request.trackedPostpones && preparePreamble(request);
  request.onShellError = noop;
  request = request.onShellReady;
  request();
}
function completeAll(request$given: FZ.Request): void { var request; request = request$given;
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
    1 === childSegment.status && queueCompletedSegment(boundary, childSegment);
  } else boundary.completedSegments.push(segment);
}
function finishedTask(request: FZ.Request, boundary: FZ.SuspenseBoundary | null, segment: FZ.Segment | null): void {
  if (null === boundary) {
    if (null !== segment && segment.parentFlushed) {
      if (null !== request.completedRootSegment)
        throw Error(formatProdErrorMessage(389));
      request.completedRootSegment = segment;
    }
    request.pendingRootTasks--;
    0 === request.pendingRootTasks && completeShell(request);
  } else
    boundary.pendingTasks--,
      4 !== boundary.status &&
        (0 === boundary.pendingTasks
          ? (0 === boundary.status && (boundary.status = 1),
            null !== segment &&
              segment.parentFlushed &&
              1 === segment.status &&
              queueCompletedSegment(boundary, segment),
            boundary.parentFlushed &&
              request.completedBoundaries.push(boundary),
            1 === boundary.status &&
              (boundary.fallbackAbortableTasks.forEach(abortTaskSoft, request),
              boundary.fallbackAbortableTasks.clear(),
              0 === request.pendingRootTasks &&
                null === request.trackedPostpones &&
                null !== boundary.contentPreamble &&
                preparePreamble(request)))
          : null !== segment &&
            segment.parentFlushed &&
            1 === segment.status &&
            (queueCompletedSegment(boundary, segment),
            1 === boundary.completedSegments.length &&
              boundary.parentFlushed &&
              request.partialBoundaries.push(boundary)));
  request.allPendingTasks--;
  0 === request.allPendingTasks && completeAll(request);
}
function performWork(request$jscomp$2: FZ.Request): void { var request$asDigest: FZ.ErrorDigest, request$jscomp$0$asDigest: FZ.ErrorDigest, request$jscomp$1$asSegment: FZ.Segment;
  if (14 !== request$jscomp$2.status && 13 !== request$jscomp$2.status) {
    var prevContext = currentActiveSnapshot,
      prevDispatcher = ReactSharedInternals.H;
    ReactSharedInternals.H = HooksDispatcher;
    var prevAsyncDispatcher = ReactSharedInternals.A;
    ReactSharedInternals.A = DefaultAsyncDispatcher;
    var prevRequest = currentRequest;
    currentRequest = request$jscomp$2;
    var prevResumableState = currentResumableState;
    currentResumableState = request$jscomp$2.resumableState;
    try {
      var pingedTasks = request$jscomp$2.pingedTasks,
        i: FZ.int32;
      for (i = 0; i < pingedTasks.length; i++) {
        var task = pingedTasks[i],
          request = request$jscomp$2,
          segment = task.blockedSegment;
        if (null === segment) {
          var request$jscomp$0 = request;
          if (0 !== task.replay!.pendingTasks) {
            switchContext(task.context);
            try {
              "number" === typeof task.replay!.slots
                ? resumeNode(
                    request$jscomp$0,
                    task,
                    task.replay!.slots,
                    task.node,
                    task.childIndex
                  )
                : retryNode(request$jscomp$0, task);
              if (
                1 === task.replay!.pendingTasks &&
                0 < task.replay!.nodes.length
              )
                throw Error(formatProdErrorMessage(488));
              task.replay!.pendingTasks--;
              task.abortSet.delete(task);
              finishedTask(request$jscomp$0, task.blockedBoundary, null);
            } catch (thrownValue: FZ.Thrown) {
              resetHooksState();
              var x =
                thrownValue === SuspenseException
                  ? getSuspendedThenable()
                  : thrownValue;
              if (
                "object" === typeof x &&
                null !== x &&
                "function" === typeof x.then
              ) {
                var ping = task.ping;
                x.then(ping, ping);
                task.thenableState = getThenableStateAfterSuspending();
              } else {
                task.replay!.pendingTasks--;
                task.abortSet.delete(task);
                var errorInfo = getThrownInfo(task.componentStack);
                request$asDigest = void 0;
                var request$jscomp$1 = request$jscomp$0,
                  boundary = task.blockedBoundary,
                  error$jscomp$0 =
                    12 === request$jscomp$0.status
                      ? request$jscomp$0.fatalError
                      : x,
                  replayNodes = task.replay!.nodes,
                  resumeSlots = task.replay!.slots;
                request$asDigest = logRecoverableError(
                  request$jscomp$1,
                  error$jscomp$0,
                  errorInfo
                );
                abortRemainingReplayNodes(
                  request$jscomp$1,
                  boundary,
                  replayNodes,
                  resumeSlots,
                  error$jscomp$0,
                  request$asDigest
                );
                request$jscomp$0.pendingRootTasks--;
                0 === request$jscomp$0.pendingRootTasks &&
                  completeShell(request$jscomp$0);
                request$jscomp$0.allPendingTasks--;
                0 === request$jscomp$0.allPendingTasks &&
                  completeAll(request$jscomp$0);
              }
            } finally {
            }
          }
        } else if (
          ((request$jscomp$0$asDigest = void 0),
          (request$jscomp$1$asSegment = segment),
          0 === request$jscomp$1$asSegment.status)
        ) {
          request$jscomp$1$asSegment.status = 6;
          switchContext(task.context);
          var childrenLength: FZ.ChunkIndex = request$jscomp$1$asSegment.children.length,
            chunkLength: FZ.ChunkIndex = request$jscomp$1$asSegment.chunks.length;
          try {
            retryNode(request, task),
              pushSegmentFinale(
                request$jscomp$1$asSegment.chunks,
                request.renderState,
                request$jscomp$1$asSegment.lastPushedText,
                request$jscomp$1$asSegment.textEmbedded
              ),
              task.abortSet.delete(task),
              (request$jscomp$1$asSegment.status = 1),
              finishedTask(request, task.blockedBoundary, request$jscomp$1$asSegment);
          } catch (thrownValue: FZ.Thrown) {
            resetHooksState();
            request$jscomp$1$asSegment.children.length = childrenLength;
            request$jscomp$1$asSegment.chunks.length = chunkLength;
            var x$jscomp$0 =
              thrownValue === SuspenseException
                ? getSuspendedThenable()
                : 12 === request.status
                  ? request.fatalError
                  : thrownValue;
            if (
              "object" === typeof x$jscomp$0 &&
              null !== x$jscomp$0 &&
              "function" === typeof x$jscomp$0.then
            ) {
              request$jscomp$1$asSegment.status = 0;
              task.thenableState = getThenableStateAfterSuspending();
              var ping$jscomp$0 = task.ping;
              x$jscomp$0.then(ping$jscomp$0, ping$jscomp$0);
            } else {
              var errorInfo$jscomp$0 = getThrownInfo(task.componentStack);
              task.abortSet.delete(task);
              request$jscomp$1$asSegment.status = 4;
              var boundary$jscomp$0 = task.blockedBoundary;
              request$jscomp$0$asDigest = logRecoverableError(
                request,
                x$jscomp$0,
                errorInfo$jscomp$0
              );
              null === boundary$jscomp$0
                ? fatalError(request, x$jscomp$0)
                : (boundary$jscomp$0.pendingTasks--,
                  4 !== boundary$jscomp$0.status &&
                    ((boundary$jscomp$0.status = 4),
                    (boundary$jscomp$0.errorDigest = request$jscomp$0$asDigest),
                    untrackBoundary(request, boundary$jscomp$0),
                    boundary$jscomp$0.parentFlushed &&
                      request.clientRenderedBoundaries.push(boundary$jscomp$0),
                    0 === request.pendingRootTasks &&
                      null === request.trackedPostpones &&
                      null !== boundary$jscomp$0.contentPreamble &&
                      preparePreamble(request)));
              request.allPendingTasks--;
              0 === request.allPendingTasks && completeAll(request);
            }
          } finally {
          }
        }
      }
      pingedTasks.splice(0, i);
      null !== request$jscomp$2.destination &&
        flushCompletedQueues(request$jscomp$2, request$jscomp$2.destination);
    } catch (error: FZ.Thrown) {
      logRecoverableError(request$jscomp$2, error, {}),
        fatalError(request$jscomp$2, error);
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
  for (var pendingPreambles = !1, i: FZ.int32 = 0; i < segment.children.length; i++)
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
  var preamble = boundary.contentPreamble,
    fallbackPreamble = boundary.fallbackPreamble;
  if (null === preamble || null === fallbackPreamble) return !1;
  switch (boundary.status) {
    case 1:
      hoistPreambleState(request.renderState, preamble);
      segment = boundary.completedSegments[0];
      if (!segment) throw Error(formatProdErrorMessage(391));
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
          hoistPreambleState(request.renderState, fallbackPreamble),
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
      hasPendingPreambles = preparePreambleFromSegment(
        request,
        request.completedRootSegment,
        collectedPreambleSegments
      ),
      preamble = request.renderState.preamble;
    if (
      !1 === hasPendingPreambles ||
      (preamble.headChunks && preamble.bodyChunks)
    )
      request.completedPreambleSegments = collectedPreambleSegments;
  }
}
function flushSubtree(request$given: FZ.Request, destination: FZ.Destination, segment$given: FZ.Segment, hoistableState$given: FZ.HoistableState | null): boolean { var request, segment, hoistableState; request = request$given; segment = segment$given; hoistableState = hoistableState$given;
  segment.parentFlushed = !0;
  switch (segment.status) {
    case 0:
      segment.id = request.nextSegmentId++;
    case 5:
      return (
        (hoistableState = segment.id),
        (segment.lastPushedText = !1),
        (segment.textEmbedded = !1),
        (request = request.renderState),
        destination.push('<template id="'),
        destination.push(request.placeholderPrefix),
        (request = hoistableState.toString(16)),
        destination.push(request),
        destination.push('"></template>')
      );
    case 1:
      segment.status = 2;
      var r$asSegment: FZ.Segment; var r: boolean = !0,
        chunks = segment.chunks,
        chunkIdx: FZ.ChunkIndex = 0;
      segment = segment.children;
      for (var childIdx: FZ.ChunkIndex = 0; childIdx < segment.length; childIdx++) {
        for (r$asSegment = segment[childIdx]; chunkIdx < r$asSegment.index; chunkIdx++)
          destination.push(chunks[chunkIdx]);
        r = flushSegment(request, destination, r$asSegment, hoistableState);
      }
      for (; chunkIdx < chunks.length - 1; chunkIdx++)
        destination.push(chunks[chunkIdx]);
      chunkIdx < chunks.length && (r = destination.push(chunks[chunkIdx]));
      return r;
    default:
      throw Error(formatProdErrorMessage(390));
  }
}
function flushSegment(request: FZ.Request, destination: FZ.Destination, segment$given: FZ.Segment, hoistableState: FZ.HoistableState | null): boolean { var segment; segment = segment$given; var request$asPreamble: FZ.PreambleState | null, boundary$asHoistables: FZ.HoistableState;
  var boundary = segment.boundary;
  if (null === boundary)
    return flushSubtree(request, destination, segment, hoistableState);
  boundary.parentFlushed = !0;
  if (4 === boundary.status) {
    if (!request.renderState.generateStaticMarkup) {
      var errorDigest = boundary.errorDigest;
      destination.push("\x3c!--$!--\x3e");
      destination.push("<template");
      errorDigest &&
        (destination.push(' data-dgst="'),
        (errorDigest = escapeTextForBrowser(errorDigest)),
        destination.push(errorDigest),
        destination.push('"'));
      destination.push("></template>");
    }
    flushSubtree(request, destination, segment, hoistableState);
    request.renderState.generateStaticMarkup
      ? (destination = !0)
      : ((request$asPreamble = boundary.fallbackPreamble) &&
          writePreambleContribution(destination, request$asPreamble),
        (destination = destination.push("\x3c!--/$--\x3e")));
    return destination;
  }
  if (1 !== boundary.status)
    return (
      0 === boundary.status &&
        (boundary.rootSegmentID = request.nextSegmentId++),
      0 < boundary.completedSegments.length &&
        request.partialBoundaries.push(boundary),
      writeStartPendingSuspenseBoundary(
        destination,
        request.renderState,
        boundary.rootSegmentID
      ),
      hoistableState &&
        ((boundary$asHoistables = boundary.fallbackState),
        boundary$asHoistables.styles.forEach(hoistStyleQueueDependency, hoistableState),
        boundary$asHoistables.stylesheets.forEach(
          hoistStylesheetDependency,
          hoistableState
        )),
      flushSubtree(request, destination, segment, hoistableState),
      destination.push("\x3c!--/$--\x3e")
    );
  if (boundary.byteSize > request.progressiveChunkSize)
    return (
      (boundary.rootSegmentID = request.nextSegmentId++),
      request.completedBoundaries.push(boundary),
      writeStartPendingSuspenseBoundary(
        destination,
        request.renderState,
        boundary.rootSegmentID
      ),
      flushSubtree(request, destination, segment, hoistableState),
      destination.push("\x3c!--/$--\x3e")
    );
  hoistableState &&
    ((segment = boundary.contentState),
    segment.styles.forEach(hoistStyleQueueDependency, hoistableState),
    segment.stylesheets.forEach(hoistStylesheetDependency, hoistableState));
  request.renderState.generateStaticMarkup ||
    destination.push("\x3c!--$--\x3e");
  segment = boundary.completedSegments;
  if (1 !== segment.length) throw Error(formatProdErrorMessage(391));
  flushSegment(request, destination, segment[0], hoistableState);
  request.renderState.generateStaticMarkup
    ? (destination = !0)
    : ((request$asPreamble = boundary.contentPreamble) &&
        writePreambleContribution(destination, request$asPreamble),
      (destination = destination.push("\x3c!--/$--\x3e")));
  return destination;
}
function flushSegmentContainer(request: FZ.Request, destination: FZ.Destination, segment: FZ.Segment, hoistableState: FZ.HoistableState): boolean {
  writeStartSegment(
    destination,
    request.renderState,
    segment.parentFormatContext,
    segment.id
  );
  flushSegment(request, destination, segment, hoistableState);
  return writeEndSegment(destination, segment.parentFormatContext);
}
function flushCompletedBoundary(request$given: FZ.Request, destination: FZ.Destination, boundary$given: FZ.SuspenseBoundary): boolean { var request: FZ.Request, boundary: FZ.SuspenseBoundary; request = request$given; boundary = boundary$given; var request$asRenderState: FZ.RenderState; var boundary$asHoistables: FZ.HoistableState; var boundary$asWritten: boolean; var completedSegments$asResumableState: FZ.ResumableState, completedSegments$asId: string;
  for (
    var completedSegments = boundary.completedSegments, i: FZ.int32 = 0;
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
  writeHoistablesForBoundary(
    destination,
    boundary.contentState,
    request.renderState
  );
  completedSegments$asResumableState = request.resumableState;
  request$asRenderState = request.renderState;
  i = boundary.rootSegmentID;
  boundary$asHoistables = boundary.contentState;
  var requiresStyleInsertion = request$asRenderState.stylesToHoist;
  request$asRenderState.stylesToHoist = !1;
  destination.push(request$asRenderState.startInlineScript);
  requiresStyleInsertion
    ? 0 === (completedSegments$asResumableState.instructions & 2)
      ? ((completedSegments$asResumableState.instructions |= 10),
        destination.push(
          '$RC=function(b,c,e){c=document.getElementById(c);c.parentNode.removeChild(c);var a=document.getElementById(b);if(a){b=a.previousSibling;if(e)b.data="$!",a.setAttribute("data-dgst",e);else{e=b.parentNode;a=b.nextSibling;var f=0;do{if(a&&8===a.nodeType){var d=a.data;if("/$"===d)if(0===f)break;else f--;else"$"!==d&&"$?"!==d&&"$!"!==d||f++}d=a.nextSibling;e.removeChild(a);a=d}while(a);for(;c.firstChild;)e.insertBefore(c.firstChild,a);b.data="$"}b._reactRetry&&b._reactRetry()}};$RM=new Map;\n$RR=function(t,u,y){function v(n){this._p=null;n()}for(var w=$RC,p=$RM,q=new Map,r=document,g,b,h=r.querySelectorAll("link[data-precedence],style[data-precedence]"),x=[],k=0;b=h[k++];)"not all"===b.getAttribute("media")?x.push(b):("LINK"===b.tagName&&p.set(b.getAttribute("href"),b),q.set(b.dataset.precedence,g=b));b=0;h=[];var l,a;for(k=!0;;){if(k){var e=y[b++];if(!e){k=!1;b=0;continue}var c=!1,m=0;var d=e[m++];if(a=p.get(d)){var f=a._p;c=!0}else{a=r.createElement("link");a.href=\nd;a.rel="stylesheet";for(a.dataset.precedence=l=e[m++];f=e[m++];)a.setAttribute(f,e[m++]);f=a._p=new Promise(function(n,z){a.onload=v.bind(a,n);a.onerror=v.bind(a,z)});p.set(d,a)}d=a.getAttribute("media");!f||d&&!matchMedia(d).matches||h.push(f);if(c)continue}else{a=x[b++];if(!a)break;l=a.getAttribute("data-precedence");a.removeAttribute("media")}c=q.get(l)||g;c===g&&(g=a);q.set(l,a);c?c.parentNode.insertBefore(a,c.nextSibling):(c=r.head,c.insertBefore(a,c.firstChild))}Promise.all(h).then(w.bind(null,\nt,u,""),w.bind(null,t,u,"Resource failed to load"))};$RR("'
        ))
      : 0 === (completedSegments$asResumableState.instructions & 8)
        ? ((completedSegments$asResumableState.instructions |= 8),
          destination.push(
            '$RM=new Map;\n$RR=function(t,u,y){function v(n){this._p=null;n()}for(var w=$RC,p=$RM,q=new Map,r=document,g,b,h=r.querySelectorAll("link[data-precedence],style[data-precedence]"),x=[],k=0;b=h[k++];)"not all"===b.getAttribute("media")?x.push(b):("LINK"===b.tagName&&p.set(b.getAttribute("href"),b),q.set(b.dataset.precedence,g=b));b=0;h=[];var l,a;for(k=!0;;){if(k){var e=y[b++];if(!e){k=!1;b=0;continue}var c=!1,m=0;var d=e[m++];if(a=p.get(d)){var f=a._p;c=!0}else{a=r.createElement("link");a.href=\nd;a.rel="stylesheet";for(a.dataset.precedence=l=e[m++];f=e[m++];)a.setAttribute(f,e[m++]);f=a._p=new Promise(function(n,z){a.onload=v.bind(a,n);a.onerror=v.bind(a,z)});p.set(d,a)}d=a.getAttribute("media");!f||d&&!matchMedia(d).matches||h.push(f);if(c)continue}else{a=x[b++];if(!a)break;l=a.getAttribute("data-precedence");a.removeAttribute("media")}c=q.get(l)||g;c===g&&(g=a);q.set(l,a);c?c.parentNode.insertBefore(a,c.nextSibling):(c=r.head,c.insertBefore(a,c.firstChild))}Promise.all(h).then(w.bind(null,\nt,u,""),w.bind(null,t,u,"Resource failed to load"))};$RR("'
          ))
        : destination.push('$RR("')
    : 0 === (completedSegments$asResumableState.instructions & 2)
      ? ((completedSegments$asResumableState.instructions |= 2),
        destination.push(
          '$RC=function(b,c,e){c=document.getElementById(c);c.parentNode.removeChild(c);var a=document.getElementById(b);if(a){b=a.previousSibling;if(e)b.data="$!",a.setAttribute("data-dgst",e);else{e=b.parentNode;a=b.nextSibling;var f=0;do{if(a&&8===a.nodeType){var d=a.data;if("/$"===d)if(0===f)break;else f--;else"$"!==d&&"$?"!==d&&"$!"!==d||f++}d=a.nextSibling;e.removeChild(a);a=d}while(a);for(;c.firstChild;)e.insertBefore(c.firstChild,a);b.data="$"}b._reactRetry&&b._reactRetry()}};$RC("'
        ))
      : destination.push('$RC("');
  completedSegments$asId = i.toString(16);
  destination.push(request$asRenderState.boundaryPrefix);
  destination.push(completedSegments$asId);
  destination.push('","');
  destination.push(request$asRenderState.segmentPrefix);
  destination.push(completedSegments$asId);
  requiresStyleInsertion
    ? (destination.push('",'),
      writeStyleResourceDependenciesInJS(destination, boundary$asHoistables))
    : destination.push('"');
  boundary$asWritten = destination.push(")\x3c/script>");
  return writeBootstrap(destination, request$asRenderState) && boundary$asWritten;
}
function flushPartiallyCompletedSegment(
  request$given: FZ.Request,
  destination$given: FZ.Destination,
  boundary$given: FZ.SuspenseBoundary,
  segment: FZ.Segment
): boolean { var request, destination, boundary; request = request$given; destination = destination$given; boundary = boundary$given;
  if (2 === segment.status) return !0;
  var hoistableState = boundary.contentState,
    segmentID: FZ.SegmentId | string = segment.id;
  if (-1 === segmentID) {
    if (-1 === (segment.id = boundary.rootSegmentID))
      throw Error(formatProdErrorMessage(392));
    return flushSegmentContainer(request, destination, segment, hoistableState);
  }
  if (segmentID === boundary.rootSegmentID)
    return flushSegmentContainer(request, destination, segment, hoistableState);
  flushSegmentContainer(request, destination, segment, hoistableState);
  boundary = request.resumableState;
  request = request.renderState;
  destination.push(request.startInlineScript);
  0 === (boundary.instructions & 1)
    ? ((boundary.instructions |= 1),
      destination.push(
        '$RS=function(a,b){a=document.getElementById(a);b=document.getElementById(b);for(a.parentNode.removeChild(a);a.firstChild;)b.parentNode.insertBefore(a.firstChild,b);b.parentNode.removeChild(b)};$RS("'
      ))
    : destination.push('$RS("');
  destination.push(request.segmentPrefix);
  segmentID = segmentID.toString(16);
  destination.push(segmentID);
  destination.push('","');
  destination.push(request.placeholderPrefix);
  destination.push(segmentID);
  destination = destination.push('")\x3c/script>');
  return destination;
}
function flushCompletedQueues(request: FZ.Request, destination: FZ.Destination): void { var i$asResumable: FZ.ResumableState, renderState$jscomp$0$asDestination: FZ.Destination, clientRenderedBoundaries$asRequest: FZ.Request, boundary$asDestination: FZ.Destination, partialBoundaries$asChunk: FZ.Chunk, i$asChunk: FZ.Chunk;
  try {
    if (!(0 < request.pendingRootTasks)) {
      var i: FZ.int32,
        completedRootSegment: FZ.Segment | FZ.int32 | null = request.completedRootSegment;
      if (null !== completedRootSegment) {
        if (5 === completedRootSegment.status) return;
        var completedPreambleSegments: FZ.Segment[][] | FZ.int32 | null = request.completedPreambleSegments;
        if (null === completedPreambleSegments) return;
        var renderState: FZ.RenderState | FZ.int32 = request.renderState,
          preamble: FZ.PreambleState | FZ.int32 = renderState.preamble,
          htmlChunks = preamble.htmlChunks,
          headChunks = preamble.headChunks,
          i$jscomp$0: FZ.int32;
        if (htmlChunks) {
          for (i$jscomp$0 = 0; i$jscomp$0 < htmlChunks.length; i$jscomp$0++)
            destination.push(htmlChunks[i$jscomp$0]);
          if (headChunks)
            for (i$jscomp$0 = 0; i$jscomp$0 < headChunks.length; i$jscomp$0++)
              destination.push(headChunks[i$jscomp$0]);
          else {
            var chunk = startChunkForTag("head");
            destination.push(chunk);
            destination.push(">");
          }
        } else if (headChunks)
          for (i$jscomp$0 = 0; i$jscomp$0 < headChunks.length; i$jscomp$0++)
            destination.push(headChunks[i$jscomp$0]);
        var charsetChunks = renderState.charsetChunks;
        for (i$jscomp$0 = 0; i$jscomp$0 < charsetChunks.length; i$jscomp$0++)
          destination.push(charsetChunks[i$jscomp$0]);
        charsetChunks.length = 0;
        renderState.preconnects.forEach(flushResource, destination);
        renderState.preconnects.clear();
        var viewportChunks = renderState.viewportChunks;
        for (i$jscomp$0 = 0; i$jscomp$0 < viewportChunks.length; i$jscomp$0++)
          destination.push(viewportChunks[i$jscomp$0]);
        viewportChunks.length = 0;
        renderState.fontPreloads.forEach(flushResource, destination);
        renderState.fontPreloads.clear();
        renderState.highImagePreloads.forEach(flushResource, destination);
        renderState.highImagePreloads.clear();
        renderState.styles.forEach(flushStylesInPreamble, destination);
        var importMapChunks = renderState.importMapChunks;
        for (i$jscomp$0 = 0; i$jscomp$0 < importMapChunks.length; i$jscomp$0++)
          destination.push(importMapChunks[i$jscomp$0]);
        importMapChunks.length = 0;
        renderState.bootstrapScripts.forEach(flushResource, destination);
        renderState.scripts.forEach(flushResource, destination);
        renderState.scripts.clear();
        renderState.bulkPreloads.forEach(flushResource, destination);
        renderState.bulkPreloads.clear();
        var hoistableChunks = renderState.hoistableChunks;
        for (i$jscomp$0 = 0; i$jscomp$0 < hoistableChunks.length; i$jscomp$0++)
          destination.push(hoistableChunks[i$jscomp$0]);
        for (
          renderState = hoistableChunks.length = 0;
          renderState < completedPreambleSegments.length;
          renderState++
        ) {
          var segments = completedPreambleSegments[renderState];
          for (preamble = 0; preamble < segments.length; preamble++)
            flushSegment(request, destination, segments[preamble], null);
        }
        var preamble$jscomp$0 = request.renderState.preamble,
          headChunks$jscomp$0 = preamble$jscomp$0.headChunks;
        if (preamble$jscomp$0.htmlChunks || headChunks$jscomp$0) {
          var chunk$jscomp$0 = endChunkForTag("head");
          destination.push(chunk$jscomp$0);
        }
        var bodyChunks = preamble$jscomp$0.bodyChunks;
        if (bodyChunks)
          for (
            completedPreambleSegments = 0;
            completedPreambleSegments < bodyChunks.length;
            completedPreambleSegments++
          )
            destination.push(bodyChunks[completedPreambleSegments]);
        flushSegment(request, destination, completedRootSegment, null);
        request.completedRootSegment = null;
        writeBootstrap(destination, request.renderState);
      }
      var renderState$jscomp$0 = request.renderState;
      completedRootSegment = 0;
      var viewportChunks$jscomp$0 = renderState$jscomp$0.viewportChunks;
      for (
        completedRootSegment = 0;
        completedRootSegment < viewportChunks$jscomp$0.length;
        completedRootSegment++
      )
        destination.push(viewportChunks$jscomp$0[completedRootSegment]);
      viewportChunks$jscomp$0.length = 0;
      renderState$jscomp$0.preconnects.forEach(flushResource, destination);
      renderState$jscomp$0.preconnects.clear();
      renderState$jscomp$0.fontPreloads.forEach(flushResource, destination);
      renderState$jscomp$0.fontPreloads.clear();
      renderState$jscomp$0.highImagePreloads.forEach(
        flushResource,
        destination
      );
      renderState$jscomp$0.highImagePreloads.clear();
      renderState$jscomp$0.styles.forEach(preloadLateStyles, destination);
      renderState$jscomp$0.scripts.forEach(flushResource, destination);
      renderState$jscomp$0.scripts.clear();
      renderState$jscomp$0.bulkPreloads.forEach(flushResource, destination);
      renderState$jscomp$0.bulkPreloads.clear();
      var hoistableChunks$jscomp$0 = renderState$jscomp$0.hoistableChunks;
      for (
        completedRootSegment = 0;
        completedRootSegment < hoistableChunks$jscomp$0.length;
        completedRootSegment++
      )
        destination.push(hoistableChunks$jscomp$0[completedRootSegment]);
      hoistableChunks$jscomp$0.length = 0;
      var clientRenderedBoundaries = request.clientRenderedBoundaries;
      for (i = 0; i < clientRenderedBoundaries.length; i++) {
        var boundary = clientRenderedBoundaries[i];
        renderState$jscomp$0$asDestination = destination;
        var resumableState = request.resumableState,
          renderState$jscomp$1 = request.renderState,
          id: FZ.SegmentId = boundary.rootSegmentID,
          errorDigest = boundary.errorDigest;
        renderState$jscomp$0$asDestination.push(renderState$jscomp$1.startInlineScript);
        0 === (resumableState.instructions & 4)
          ? ((resumableState.instructions |= 4),
            renderState$jscomp$0$asDestination.push(
              '$RX=function(b,c,d,e,f){var a=document.getElementById(b);a&&(b=a.previousSibling,b.data="$!",a=a.dataset,c&&(a.dgst=c),d&&(a.msg=d),e&&(a.stck=e),f&&(a.cstck=f),b._reactRetry&&b._reactRetry())};;$RX("'
            ))
          : renderState$jscomp$0$asDestination.push('$RX("');
        renderState$jscomp$0$asDestination.push(renderState$jscomp$1.boundaryPrefix);
        var chunk$jscomp$1 = id.toString(16);
        renderState$jscomp$0$asDestination.push(chunk$jscomp$1);
        renderState$jscomp$0$asDestination.push('"');
        if (errorDigest) {
          renderState$jscomp$0$asDestination.push(",");
          var chunk$jscomp$2 = escapeJSStringsForInstructionScripts(
            errorDigest || ""
          );
          renderState$jscomp$0$asDestination.push(chunk$jscomp$2);
        }
        var JSCompiler_inline_result: boolean | FZ.int32 =
          renderState$jscomp$0$asDestination.push(")\x3c/script>");
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
      var partialBoundaries = request.partialBoundaries;
      for (i = 0; i < partialBoundaries.length; i++) {
        var boundary$51 = partialBoundaries[i];
        a: {
          clientRenderedBoundaries$asRequest = request;
          boundary$asDestination = destination;
          var completedSegments = boundary$51.completedSegments;
          for (
            JSCompiler_inline_result = 0;
            JSCompiler_inline_result < completedSegments.length;
            JSCompiler_inline_result++
          )
            if (
              !flushPartiallyCompletedSegment(
                clientRenderedBoundaries$asRequest,
                boundary$asDestination,
                boundary$51,
                completedSegments[JSCompiler_inline_result]
              )
            ) {
              JSCompiler_inline_result++;
              completedSegments.splice(0, JSCompiler_inline_result);
              var JSCompiler_inline_result$jscomp$0 = !1;
              break a;
            }
          completedSegments.splice(0, JSCompiler_inline_result);
          JSCompiler_inline_result$jscomp$0 = writeHoistablesForBoundary(
            boundary$asDestination,
            boundary$51.contentState,
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
    0 === request.allPendingTasks &&
      0 === request.pingedTasks.length &&
      0 === request.clientRenderedBoundaries.length &&
      0 === request.completedBoundaries.length &&
      ((request.flushScheduled = !1),
      (i$asResumable = request.resumableState),
      i$asResumable.hasBody &&
        ((partialBoundaries$asChunk = endChunkForTag("body")),
        destination.push(partialBoundaries$asChunk)),
      i$asResumable.hasHtml && ((i$asChunk = endChunkForTag("html")), destination.push(i$asChunk)),
      (request.status = 14),
      destination.push(null),
      (request.destination = null));
  }
}
function enqueueFlush(request: FZ.Request): void {
  if (
    !1 === request.flushScheduled &&
    0 === request.pingedTasks.length &&
    null !== request.destination
  ) {
    request.flushScheduled = !0;
    var destination = request.destination;
    destination
      ? flushCompletedQueues(request, destination)
      : (request.flushScheduled = !1);
  }
}
function startFlowing(request: FZ.Request, destination: FZ.Destination): void {
  if (13 === request.status)
    (request.status = 14), destination.destroy(request.fatalError);
  else if (14 !== request.status && null === request.destination) {
    request.destination = destination;
    try {
      flushCompletedQueues(request, destination);
    } catch (error) {
      logRecoverableError(request, error, {}), fatalError(request, error);
    }
  }
}
function abort(request: FZ.Request, reason: FZ.Thrown): void {
  if (11 === request.status || 10 === request.status) request.status = 12;
  try {
    var abortableTasks = request.abortableTasks;
    if (0 < abortableTasks.size) {
      var error: FZ.Thrown =
        void 0 === reason
          ? Error(formatProdErrorMessage(432))
          : "object" === typeof reason &&
              null !== reason &&
              "function" === typeof reason.then
            ? Error(formatProdErrorMessage(530))
            : reason;
      request.fatalError = error;
      abortableTasks.forEach(function (task) {
        return abortTask(task, request, error);
      });
      abortableTasks.clear();
    }
    null !== request.destination &&
      flushCompletedQueues(request, request.destination);
  } catch (error$53) {
    logRecoverableError(request, error$53, {}), fatalError(request, error$53);
  }
}
function onError(): void {}
function renderToStringImpl(
  children$given: FZ.ReactNode,
  options$given: FZ.Options,
  generateStaticMarkup: boolean,
  abortReason: string
): string { var children, options; children = children$given; options = options$given;
  var didFatal = !1,
    fatalError: FZ.Thrown = null,
    result = "",
    readyToStream = !1;
  options = createResumableState(options ? options.identifierPrefix : void 0);
  children = createRequest(
    children,
    options,
    createRenderState(options, generateStaticMarkup),
    createFormatContext(0, null, 0),
    Infinity,
    onError,
    void 0,
    function () {
      readyToStream = !0;
    },
    void 0,
    void 0,
    void 0
  );
  children.flushScheduled = null !== children.destination;
  performWork(children);
  10 === children.status && (children.status = 11);
  null === children.trackedPostpones &&
    safelyEmitEarlyPreloads(children, 0 === children.pendingRootTasks);
  abort(children, abortReason);
  startFlowing(children, {
    push: function (chunk: FZ.Chunk | null) {
      null !== chunk && (result += chunk);
      return !0;
    },
    destroy: function (error: FZ.Thrown) {
      didFatal = !0;
      fatalError = error;
    }
  });
  if (didFatal && fatalError !== abortReason) throw fatalError;
  if (!readyToStream) throw Error(formatProdErrorMessage(426));
  return result;
}
exports.renderToStaticMarkup = function (children: FZ.ReactNode, options: FZ.Options): string {
  return renderToStringImpl(
    children,
    options,
    !0,
    'The server used "renderToStaticMarkup" which does not support Suspense. If you intended to have the server wait for the suspended component please switch to "renderToReadableStream" which supports Suspense on the server'
  );
};
exports.renderToString = function (children: FZ.ReactNode, options: FZ.Options): string {
  return renderToStringImpl(
    children,
    options,
    !1,
    'The server used "renderToString" which does not support Suspense. If you intended for this Suspense boundary to render the fallback content on the server consider throwing an Error somewhere within the Suspense boundary. If you intended to have the server wait for the suspended component please switch to "renderToReadableStream" which supports Suspense on the server'
  );
};
exports.version = "19.1.0";
namespace FZ {
  export type FulfilledValue = any;
  export type ComparedValue = any;
}
namespace FZ {
  export type MemoValue = any;
  export type UsedValue = any;
  export type PostponeHandler = (reason: string, postponeInfo: ThrownInfo) => void;
}
namespace FZ {
  export type int32 = import("bun").int32;
  export type RequestStatus = int32;
  export type SegmentStatus = int32;
  export type BoundaryStatus = int32;
  export type StylesheetState = int32;
  export type InsertionMode = int32;
  export type TagScope = int32;
  export type PreambleContribution = int32;
  export type InstructionState = int32;
  export type SegmentId = int32;
  export type ChildIndex = int32;
  export type TaskCount = int32;
  export type ChunkIndex = int32;
  export type TreeId = int32;
  export type ContextDepth = int32;
  export type HookCounter = int32;
  export type ByteSize = number;
  export type HeaderCapacity = number;
  export type ReactNode = any;
  export type ReactElement = any;
  export type Props = any;
  export type PropValue = any;
  export type ElementType = any;
  export type ComponentName = any;
  export type KeyOrIndex = any;
  export type FunctionComponent = any;
  export type ClassComponent = any;
  export type ClassInstance = any;
  export type ClassState = any;
  export type Ref = any;
  export type ReactContext = any;
  export type ContextValue = any;
  export type LazyComponent = any;
  export type Thenable = any;
  export type Thrown = any;
  export type HookState = any;
  export type HookDeps = any;
  export type IteratorFn = any;
  export type Destination = any;
  export type Options = any;
  export type ReactFormState = any;
  export type FormAction = any;
  export type CustomFormFields = any;
  export type FormDataGiven = any;
  export type SelectedValue = any;
  export type BootstrapScriptContent = any;
  export type BootstrapScripts = any;
  export type ReactModule = any;
  export type ReactDOMModule = any;
  export type SharedInternals = any;
  export type DOMSharedInternals = any;
  export type HostDispatcherGiven = any;
  export type GivenFunction = any;
  export type Chunk = string;
  export type PrecomputedChunk = string;
  export type Resource = Chunk[];
  export type PropsBag = { [name: string]: any };
  export type Assign = (target: PropsBag, ...sources: any[]) => PropsBag;
  export type NameCache = { [name: string]: boolean };
  export type PreloadState = PropValue[];
  export type ResourceDict = { [key: string]: PreloadState | null };
  export type ExistsDict = { [key: string]: null };
  export type UnknownResourceDict = { [as: string]: ResourceDict };
  export type ConnectBucket = "default" | "anonymous" | "credentials";
  export type ConnectResources = { [bucket: string]: ExistsDict };
  export type SlotMap = { [index: string]: SegmentId | undefined };
  export type ThrownInfo = { [name: string]: unknown };
  export type KeyNode = [parent: KeyNode | null, name: ComponentName, keyOrIndex: KeyOrIndex];
  export type ReplayNode = [name: ComponentName, keyOrIndex: KeyOrIndex, children: ReplayNode[], slots: ResumeSlots, fallback?: ReplayNode | null, rootSegmentID?: SegmentId];
  export type ResumeSlots = SlotMap | SegmentId | null;
  export type ThenableState = Thenable[];
  export type MemoState = [value: any, deps: HookDeps];
  export type DispatchTuple = [state: HookState, dispatch: Dispatch | null];
  export type OptimisticTuple = [state: HookState, dispatch: Dispatch];
  export type TransitionTuple = [isPending: boolean, start: (callback?: GivenFunction) => void];
  export type ActionStateTuple = [state: HookState, dispatch: ActionDispatch, isPending: boolean];
  export type ComponentFrameSample = [sample: string | null, control: string | null];
  export interface Request {
    destination: Destination;
    flushScheduled: boolean;
    resumableState: ResumableState;
    renderState: RenderState;
    rootFormatContext: FormatContext;
    progressiveChunkSize: number;
    status: RequestStatus;
    fatalError: Thrown;
    nextSegmentId: SegmentId;
    allPendingTasks: TaskCount;
    pendingRootTasks: TaskCount;
    completedRootSegment: Segment | null;
    completedPreambleSegments: Segment[][] | null;
    abortableTasks: Set<Task>;
    pingedTasks: Task[];
    clientRenderedBoundaries: SuspenseBoundary[];
    completedBoundaries: SuspenseBoundary[];
    partialBoundaries: SuspenseBoundary[];
    trackedPostpones: PostponedHoles | null;
    onError: ErrorHandler;
    onPostpone: PostponeHandler;
    onAllReady: () => void;
    onShellReady: () => void;
    onShellError: (error: Thrown) => void;
    onFatalError: (error: Thrown) => void;
    formState: ReactFormState;
  }
  export interface RequestConstructor {
    new (
      resumableState: ResumableState,
      renderState: RenderState,
      rootFormatContext: FormatContext,
      progressiveChunkSize: number | undefined,
      onError: ErrorHandler | undefined,
      onAllReady: (() => void) | undefined,
      onShellReady: (() => void) | undefined,
      onShellError: ((error: Thrown) => void) | undefined,
      onFatalError: ((error: Thrown) => void) | undefined,
      onPostpone: PostponeHandler | undefined,
      formState: ReactFormState
    ): Request;
    (this: Request,
      resumableState: ResumableState,
      renderState: RenderState,
      rootFormatContext: FormatContext,
      progressiveChunkSize: number | undefined,
      onError: ErrorHandler | undefined,
      onAllReady: (() => void) | undefined,
      onShellReady: (() => void) | undefined,
      onShellError: ((error: Thrown) => void) | undefined,
      onFatalError: ((error: Thrown) => void) | undefined,
      onPostpone: PostponeHandler | undefined,
      formState: ReactFormState
    ): void;
  }
  export type ErrorHandler = (error: Thrown, errorInfo: ThrownInfo) => any;
  export type ErrorDigest = string | null | undefined;
  export interface Task {
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
    componentStack: ComponentStackNode | null;
    thenableState: ThenableState | null;
    isFallback: boolean;
  }
  export type Ping = () => void;
  export interface Segment {
    status: SegmentStatus;
    parentFlushed: boolean;
    id: SegmentId;
    index: ChunkIndex;
    chunks: Chunk[];
    children: Segment[];
    preambleChildren: Segment[];
    parentFormatContext: FormatContext;
    boundary: SuspenseBoundary | null;
    lastPushedText: boolean;
    textEmbedded: boolean;
  }
  export interface SuspenseBoundary {
    status: BoundaryStatus;
    rootSegmentID: SegmentId;
    parentFlushed: boolean;
    pendingTasks: TaskCount;
    completedSegments: Segment[];
    byteSize: ByteSize;
    fallbackAbortableTasks: Set<Task>;
    errorDigest: ErrorDigest;
    contentState: HoistableState;
    fallbackState: HoistableState;
    contentPreamble: PreambleState | null;
    fallbackPreamble: PreambleState | null;
    trackedContentKeyPath: KeyNode | null;
    trackedFallbackNode: ReplayNode | null;
  }
  export interface PostponedHoles { workingMap: Map<KeyNode, ReplayNode>; rootNodes: ReplayNode[]; rootSlots: ResumeSlots }
  export interface ReplaySet { nodes: ReplayNode[]; slots: ResumeSlots; pendingTasks: TaskCount }
  export interface RenderState {
    placeholderPrefix: PrecomputedChunk;
    segmentPrefix: PrecomputedChunk;
    boundaryPrefix: PrecomputedChunk;
    startInlineScript: PrecomputedChunk;
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
    stylesToHoist: boolean;
    generateStaticMarkup: boolean;
  }
  export type OnHeaders = (headers: PropsBag) => void;
  export interface PreloadHeaders { preconnects: string; fontPreloads: string; highImagePreloads: string; remainingCapacity: HeaderCapacity }
  export interface ResourceResets { font: ResourceDict; dns: ExistsDict; connect: ConnectResources; image: ResourceDict; style: ResourceDict }
  export interface PreloadMaps {
    images: Map<string, Resource>;
    stylesheets: Map<string, Resource>;
    scripts: Map<string, Resource>;
    moduleScripts: Map<string, Resource>;
  }
  export interface ResumableState {
    idPrefix: string;
    nextFormID: int32;
    streamingFormat: int32;
    bootstrapScriptContent?: BootstrapScriptContent;
    bootstrapScripts?: BootstrapScripts;
    bootstrapModules?: BootstrapScripts;
    instructions: InstructionState;
    hasBody: boolean;
    hasHtml: boolean;
    unknownResources: UnknownResourceDict;
    dnsResources: ExistsDict;
    connectResources: ConnectResources;
    imageResources: ResourceDict;
    styleResources: ResourceDict;
    scriptResources: ResourceDict;
    moduleUnknownResources: UnknownResourceDict;
    moduleScriptResources: ResourceDict;
  }
  export interface PreambleState { htmlChunks: Chunk[] | null; headChunks: Chunk[] | null; bodyChunks: Chunk[] | null; contribution: PreambleContribution }
  export interface FormatContext {
    insertionMode: InsertionMode;
    selectedValue: SelectedValue;
    tagScope: TagScope;
  }
  export interface HoistableState { styles: Set<StyleQueue>; stylesheets: Set<StylesheetResource> }
  export interface StyleQueue { precedence: Chunk; rules: Chunk[]; hrefs: Chunk[]; sheets: Map<string, StylesheetResource> }
  export interface StylesheetResource { state: StylesheetState; props: PropsBag }
  export interface ContextNode {
    parent: ContextNode | null;
    depth: ContextDepth;
    context: ReactContext;
    parentValue: ContextValue;
    value: ContextValue;
  }
  export interface ComponentStackNode { parent: ComponentStackNode | null; type: ElementType }
  export interface TreeContext { id: TreeId; overflow: string }
  export interface Hook { memoizedState: HookState; queue: UpdateQueue | null; next: Hook | null }
  export interface UpdateQueue { last: Update | null; dispatch: Dispatch | null }
  export interface Update { action: HookState; next: Update | null }
  export interface RefObject { current: any }
  export type Dispatch = (action: any) => void;
  export type Reducer = (state: any, action: any) => any;
  export interface ActionDispatch { (payload: any): void; $$FORM_ACTION?: (prefix: any) => CustomFormFields }
  export interface Dispatcher {
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
  }
  export interface AsyncDispatcher { getCacheForType(resourceType?: GivenFunction): any }
  export interface FormStatusNotPending { pending: boolean; data: null; method: null; action: null }
  export interface HostDispatcher {
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
  export interface ClassComponentUpdater {
    enqueueSetState(inst: ClassInstance, payload: any, callback?: any): void;
    enqueueReplaceState(inst: ClassInstance, payload: any, callback?: any): void;
    enqueueForceUpdate(inst?: ClassInstance, callback?: any): void;
  }
  export interface InternalInstance { queue: any[] | null; replace: boolean }
  export interface ComponentIdentity { readonly $$fzIdentity?: never }
  export interface EmptyContext { readonly $$fzEmptyContext?: never }
  export interface RunInRootFrame { DetermineComponentFrameRoot: { (): ComponentFrameSample; displayName?: string } }
}
declare var console: { error(...data: any[]): void };
