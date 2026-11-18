// The names on the global objects of the web that no `.bind.ts` declares. `generate-web-globals.ts` makes the static tables.

export interface Table {
  /** Interfaces of Bun's own global object. */
  native?: string;
  nativeOperations?: string;
  /** Bun's global object has them as its own. */
  inherited?: string;
  /** What `b.interface` declares: constructors, their aliases, namespaces and legacy factory functions. */
  interfaces?: string;
  /** `webkit` and the name of an interface of Bun's. */
  prefixedNative?: string;
  emptyObjects?: string;
  /** What a schema declares, and `exposed` would put in another table. */
  declared?: string;
  /** The rest are looked up in the `members` of the realm. */
  hiddenValues?: string;
  values?: string;
}

/** Attributes whose value only changes with the document. */
export const sameObject = `caches clientInformation customElements document frames history indexedDB isSecureContext
  localStorage location navigation navigator origin performance scheduler screen self sessionStorage visualViewport window`;

/** Bun's object, whose answers depend on the realm. */
export const dependsOnRealm = "URL";

/** In src/js `process` is `@globals.process`: `@natives` in a realm of the web, which has none or its own, and the global object elsewhere. */
export const keptAside = "Bun SharedArrayBuffer atob btoa process structuredClone";

/** A program that starts in a window has Bun's names, except for these. */
export const replacesBun = `CustomEvent ErrorEvent Event EventTarget alert confirm navigator onerror onmessage
  postMessage prompt reportError self`;

export const tables = {
  everywhere: {
    native: `AbortController AbortSignal Blob ByteLengthQueuingStrategy CompressionStream CountQueuingStrategy Crypto
      DOMException DecompressionStream File FormData ReadableByteStreamController ReadableStream ReadableStreamBYOBReader
      ReadableStreamBYOBRequest ReadableStreamDefaultController ReadableStreamDefaultReader TextDecoder
      TextDecoderStream TextEncoder TextEncoderStream TransformStream TransformStreamDefaultController URL
      URLPattern URLSearchParams WritableStream WritableStreamDefaultController WritableStreamDefaultWriter`,
    nativeOperations: "crypto",
    declared: "console",
  },
  secure: {
    native: "CryptoKey SubtleCrypto",
  },
  /** What every window has. */
  document: {
    interfaces: `Animation AnimationEffect AnimationEvent AnimationPlaybackEvent AnimationTimeline AnimationTrigger CSS
      CSSAnimation CSSConditionRule CSSContainerRule CSSCounterStyleRule CSSFontFaceDescriptors CSSFontFaceRule
      CSSFontFeatureValuesMap CSSFontFeatureValuesRule CSSFontPaletteValuesRule CSSFunctionDeclarations
      CSSFunctionDescriptors CSSFunctionRule CSSGroupingRule CSSImageValue CSSImportRule CSSKeyframeRule
      CSSKeyframesRule CSSKeywordValue CSSLayerBlockRule CSSLayerStatementRule CSSMarginRule CSSMathClamp
      CSSMathInvert CSSMathMax CSSMathMin CSSMathNegate CSSMathProduct CSSMathSum CSSMathValue
      CSSMatrixComponent CSSMediaRule CSSNamespaceRule CSSNestedDeclarations CSSNumericArray CSSNumericValue
      CSSPageDescriptors CSSPageRule CSSPerspective CSSPositionTryDescriptors CSSPositionTryRule
      CSSPositionValue CSSPropertyRule CSSPseudoElement CSSRotate CSSRule CSSRuleList CSSScale CSSScopeRule
      CSSSkew CSSSkewX CSSSkewY CSSStartingStyleRule CSSStyleDeclaration CSSStyleProperties CSSStyleRule
      CSSStyleSheet CSSStyleValue CSSSupportsRule CSSTransformComponent CSSTransformValue CSSTransition
      CSSTranslate CSSUnitValue CSSUnparsedValue CSSVariableReferenceValue CSSViewTransitionRule ClipboardEvent
      CloseWatcher CommandEvent CompositionEvent ContentVisibilityAutoStateChangeEvent DOMImplementation
      DOMMatrix DOMMatrixReadOnly DOMPoint DOMPointReadOnly DOMQuad DOMRect DOMRectList DOMRectReadOnly
      DataTransfer DataTransferItem DataTransferItemList DeviceMotionEvent DeviceMotionEventAcceleration
      DeviceMotionEventRotationRate DeviceOrientationEvent DocumentTimeline DragEvent ElementInternals FileList
      FocusEvent FontFace FontFaceSet FontFaceSetLoadEvent
      FormDataEvent FragmentDirective GamepadEvent HTMLAnchorElement HTMLAreaElement HTMLBRElement
      HTMLBaseElement HTMLBodyElement HTMLButtonElement HTMLDListElement HTMLDataElement HTMLDataListElement
      HTMLDetailsElement HTMLDialogElement HTMLDirectoryElement HTMLDivElement HTMLDocument HTMLElement
      HTMLFieldSetElement HTMLFontElement HTMLFormControlsCollection HTMLFormElement HTMLFrameSetElement
      HTMLHRElement HTMLHeadElement HTMLHeadingElement HTMLHtmlElement HTMLInputElement HTMLLIElement
      HTMLLabelElement HTMLLegendElement HTMLLinkElement HTMLMapElement HTMLMarqueeElement HTMLMenuElement HTMLMetaElement
      HTMLMeterElement HTMLModElement HTMLOListElement HTMLOptGroupElement HTMLOptionElement
      HTMLOptionsCollection HTMLOutputElement HTMLParagraphElement HTMLParamElement HTMLPictureElement
      HTMLPreElement HTMLProgressElement HTMLQuoteElement HTMLScriptElement HTMLSelectElement HTMLSelectedContentElement
      HTMLSlotElement HTMLSpanElement HTMLStyleElement HTMLTableCaptionElement HTMLTableCellElement HTMLTableColElement
      HTMLTableElement HTMLTableRowElement HTMLTableSectionElement HTMLTemplateElement HTMLTextAreaElement
      HTMLTimeElement HTMLTitleElement HTMLTrackElement HTMLUListElement HTMLUnknownElement HashChangeEvent
      Highlight HighlightRegistry InputEvent InterestEvent IntersectionObserver IntersectionObserverEntry
      KeyboardEvent KeyframeEffect MediaList MediaQueryList MediaQueryListEvent MouseEvent NodeFilter
      NodeIterator PageTransitionEvent PointerEvent PopStateEvent PromiseRejectionEvent RadioNodeList
      ResizeObserver ResizeObserverEntry ResizeObserverSize ScrollTimeline SnapEvent StylePropertyMap
      StylePropertyMapReadOnly StyleSheet StyleSheetList SubmitEvent TextEvent TimelineTrigger
      TimelineTriggerRange TimelineTriggerRangeList ToggleEvent Touch TouchEvent TouchList TransitionEvent
      TreeWalker UIEvent UserActivation ValidityState ViewTimeline ViewTransition ViewTransitionTypeSet
      WebKitCSSMatrix WheelEvent XMLDocument
      CanvasGradient CanvasPattern CanvasRenderingContext2D HTMLCanvasElement ImageBitmap
      ImageBitmapRenderingContext ImageData OffscreenCanvas OffscreenCanvasRenderingContext2D
      Path2D TextMetrics CaretPosition Option PageRevealEvent Clipboard ClipboardChangeEvent ClipboardItem
      HTMLEmbedElement HTMLFrameElement HTMLIFrameElement HTMLObjectElement
      AbstractRange Attr BeforeUnloadEvent CDATASection CharacterData Comment CustomElementRegistry
      CustomEvent CustomStateSet DOMParser DOMStringMap DOMTokenList Document DocumentFragment DocumentType
      Element ErrorEvent Event EventTarget HTMLAllCollection HTMLCollection MathMLElement MutationObserver
      MutationRecord NamedNodeMap Node NodeList OpaqueRange ProcessingInstruction Range SVGAElement SVGAngle
      SVGAnimateElement SVGAnimateMotionElement SVGAnimateTransformElement SVGAnimatedAngle SVGAnimatedBoolean
      SVGAnimatedEnumeration SVGAnimatedInteger SVGAnimatedLength SVGAnimatedLengthList SVGAnimatedNumber
      SVGAnimatedNumberList SVGAnimatedPreserveAspectRatio SVGAnimatedRect SVGAnimatedString
      SVGAnimatedTransformList SVGAnimationElement SVGCircleElement SVGClipPathElement
      SVGComponentTransferFunctionElement SVGDefsElement SVGDescElement SVGElement SVGEllipseElement
      SVGFEBlendElement SVGFEColorMatrixElement SVGFEComponentTransferElement SVGFECompositeElement
      SVGFEConvolveMatrixElement SVGFEDiffuseLightingElement SVGFEDisplacementMapElement
      SVGFEDistantLightElement SVGFEDropShadowElement SVGFEFloodElement SVGFEFuncAElement SVGFEFuncBElement
      SVGFEFuncGElement SVGFEFuncRElement SVGFEGaussianBlurElement SVGFEImageElement SVGFEMergeElement
      SVGFEMergeNodeElement SVGFEMorphologyElement SVGFEOffsetElement SVGFEPointLightElement
      SVGFESpecularLightingElement SVGFESpotLightElement SVGFETileElement SVGFETurbulenceElement
      SVGFilterElement SVGForeignObjectElement SVGGElement SVGGeometryElement SVGGradientElement
      SVGGraphicsElement SVGImageElement SVGLength SVGLengthList SVGLineElement SVGLinearGradientElement
      SVGMPathElement SVGMarkerElement SVGMaskElement SVGMatrix SVGMetadataElement SVGNumber SVGNumberList
      SVGPathElement SVGPatternElement SVGPoint SVGPointList SVGPolygonElement SVGPolylineElement
      SVGPreserveAspectRatio SVGRadialGradientElement SVGRect SVGRectElement SVGSVGElement SVGScriptElement
      SVGSetElement SVGStopElement SVGStringList SVGStyleElement SVGSwitchElement SVGSymbolElement SVGTSpanElement
      SVGTextContentElement SVGTextElement SVGTextPathElement SVGTextPositioningElement SVGTitleElement
      SVGTransform SVGTransformList SVGUnitTypes SVGUseElement SVGViewElement Sanitizer Selection ShadowRoot
      StaticRange Text XMLSerializer XPathEvaluator XPathExpression XPathResult`,
  },
  /** On top of Bun's names, for `bun:desktop/dom`. */
  windowOfProgram: {
    inherited: "addEventListener dispatchEvent removeEventListener",
  },
  window: {
    nativeOperations: "atob btoa queueMicrotask",
    declared: "performance trustedTypes",
    prefixedNative: "webkitURL",
    emptyObjects: "chrome",
    interfaces: "WebKitMutationObserver",
  },
  secureWindow: {
    declared: "caches",
  },
  /** What a preload script finds. */
  node: {
    hiddenValues: "Buffer",
    values: "clearImmediate global process setImmediate",
  },
  nodeIntegration: {
    values: "module require",
  },
  worker: {
    interfaces: `DOMMatrix DOMMatrixReadOnly DOMPoint DOMPointReadOnly DOMQuad DOMRect DOMRectReadOnly FileList FontFace
      FontFaceSet FontFaceSetLoadEvent CanvasGradient CanvasPattern ImageBitmap ImageBitmapRenderingContext ImageData OffscreenCanvas
      OffscreenCanvasRenderingContext2D Path2D TextMetrics CustomEvent ErrorEvent Event EventTarget
      PromiseRejectionEvent`,
  },
  dedicatedWorker: {},
  secureDedicatedWorker: {},
  sharedWorker: {},
} satisfies Record<string, Table>;
