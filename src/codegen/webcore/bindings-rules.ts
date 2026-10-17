// The tables that bindings.ts works from. Together with idl/ they say how Bun's bindings differ from what upstream's IDL files describe.

/** A regular expression and what every match of it becomes (`$1` is the first group). */
export type Rule = [RegExp, string];

const rule = (pattern: string, replacement: string): Rule => [new RegExp(pattern, "g"), replacement];

/**
 * `[EnabledBySetting=X]`. Bun has no Settings: a member is there or it is not.
 * The value is the default for WebCore in upstream's UnifiedWebPreferences.yaml, and false where Bun does not have what the setting switches on.
 */
export const settings: Record<string, boolean> = {
  aRIAActionsSupportEnabled: false,
  altitudeAngleEnabled: true,
  azimuthAngleEnabled: true,
  captionDisplaySettingsEnabled: false,
  closeWatcherEnabled: true,
  directoryUploadEnabled: false,
  downloadAttributeEnabled: true,
  enableElementCurrentCSSZoom: false,
  enterKeyHintEnabled: true,
  exposeSpeakersEnabled: false,
  fullScreenEnabled: false,
  headingOffsetEnabled: true,
  hiddenUntilFoundEnabled: true,
  interactiveFormValidationEnabled: true,
  isARIANotifyEnabled: false,
  lazyImageLoadingEnabled: true,
  legacyEncryptedMediaAPIEnabled: false,
  modelElementImmersiveEnabled: false,
  moveBeforeEnabled: false,
  perElementSpeakerSelectionEnabled: false,
  pictureInPictureAPIEnabled: false,
  pointerLockEnabled: false,
  popoverAttributeEnabled: true,
  privateClickMeasurementEnabled: false,
  privateClickMeasurementFraudPreventionEnabled: false,
  remotePlaybackEnabled: false,
  requestVideoFrameCallbackEnabled: false,
  scopedCustomElementRegistryEnabled: false,
  scrollToTextFragmentFeatureDetectionEnabled: false,
  scrollendEventEnabled: true,
  selectShowPickerEnabled: false,
  shadowRootReferenceTargetEnabled: false,
  spatialImageControlsEnabled: false,
  spatialPortalEnabled: false,
  storageAccessAPIEnabled: false,
  switchControlEnabled: false,
  undoManagerAPIEnabled: false,
};

/** The other things a runtime-enabled member can depend on. CTX stands for "the global object's ScriptExecutionContext". */
export const otherConditions: [string, boolean][] = [
  [String.raw`DeprecatedGlobalSettings::\w+\(\)`, false], // attachmentElementEnabled, attrStyleEnabled
  [String.raw`worldForDOMObject\(\*realm\(\)\)\.\w+\(\)`, false], // [EnabledForWorld]
  [String.raw`JSElement::shouldEnableWebkitRequestFullScreen\(protect\(CTX\)\)`, false],
  [String.raw`\(realm\(\)\)->inherits<JSDOMWindowBase>\(\)`, true], // [Exposed=Window] on a partial interface
  [String.raw`CTX->isSecureContext\(\)`, true], // [SecureContext]
];

/** interface -> members that have no implementation in Bun. */
export const removedMembers: Record<string, string[]> = {
  // prettier-ignore
  Document: [
    "timeline", "fonts", "activeViewTransition", "adoptedStyleSheets", "fullscreenElement", "rootElement",
    "caretRangeFromPoint", "getCSSCanvasContext", "caretPositionFromPoint", "elementFromPoint", "elementsFromPoint",
    "execCommand", "queryCommandEnabled", "queryCommandIndeterm",
    "queryCommandState", "queryCommandSupported", "queryCommandValue", "startViewTransition", "getAnimations",
    "createExpression", "createNSResolver", "evaluate", "createTouch", "createTouchList",
  ],
  Element: ["animate", "getAnimations", "checkVisibility", "computedStyleMap"],
  HTMLElement: ["attributeStyleMap"],
  SVGElement: ["attributeStyleMap"],
  HTMLMediaElement: ["disableRemotePlayback"],
  ProcessingInstruction: ["sheet"],
  Range: ["expand"],
  ShadowRoot: ["adoptedStyleSheets", "fullscreenElement", "getAnimations", "elementFromPoint", "elementsFromPoint"],
};

/** interface -> attributes that lose their setter. */
export const readonlyAttributes: Record<string, string[]> = {
  Document: ["domain"],
};

/**
 * interface -> attributes that lose `[DOMJIT=Getter]`.
 * Document.body: the snippet compares local names with the addresses of three AtomStrings.
 * The names are per VM in Bun, and the snippet is made on a JIT compiler thread.
 */
export const withoutDOMJIT: Record<string, string[]> = {
  Document: ["body"],
};

/** Interfaces that lose `[ActiveDOMObject]`: nothing is loaded, so nothing is ever pending. */
export const notActiveDOMObjects = ["HTMLImageElement", "HTMLMarqueeElement", "HTMLSourceElement", "HTMLScriptElement"];

/** interface -> C++ enumerations whose only users are members that went. */
export const removedEnumerations: Record<string, string[]> = {
  HTMLInputElement: ["HTMLInputElement::AutofillVisibility", "HTMLInputElement::AutofillButtonType"],
};

/** Interfaces with a binding that script does not see. */
export const hiddenInterfaces = new Set(["DataTransfer", "TextEvent", "MutationEvent"]);

/** Headers that the build makes. They are not in the tree, and their `#include` stays. */
export const headersMadeByTheBuild = ["JSWindowInterfaces.lut.h"];

/** Reflected attributes that keep the generator's accessors, see outlineReflectedAttributes() in bindings.ts. */
export const hotReflectedAttributes = new Set(["Element.id", "Element.className"]);

/** Rules for every generated file. */
export const rulesForEveryFile: Rule[] = [
  // Bun's subspaceForImpl() takes the offsets of two raw-pointer members. The members are named after the wrapper class:
  // Bun's HTMLRewriter already has m_subspaceForElement and m_subspaceForComment.
  rule(
    String.raw`    return WebCore::subspaceForImpl<(JS\w+), UseCustomHeapCellType::No>\(vm, "\1"_s,
        \[\] \(auto& spaces\) \{ return spaces\.m_clientSubspaceFor\w+\.get\(\); \},
        \[\] \(auto& spaces, auto&& space\) \{ spaces\.m_clientSubspaceFor\w+ = std::forward<decltype\(space\)>\(space\); \},
        \[\] \(auto& spaces\) \{ return spaces\.m_subspaceFor\w+\.get\(\); \},
        \[\] \(auto& spaces, auto&& space\) \{ spaces\.m_subspaceFor\w+ = std::forward<decltype\(space\)>\(space\); \}
    \);`,
    "    return WebCore::subspaceForImpl<$1, UseCustomHeapCellType::No>(vm, BUN_SUBSPACE_SLOTS(m_clientSubspaceFor$1, m_subspaceFor$1));",
  ),
  // No quirks.
  rule(
    String.raw`\n?    // Temporary quirk for ungap/@custom-elements polyfill \(rdar://problem/111008826\), consider removing in 2025\.
    if \(RefPtr document = dynamicDowncast<Document>\(dynamicDowncast<JSDOMGlobalObject>\(lexicalGlobalObject\)->scriptExecutionContext\(\)\)\) \{
        if \(document->quirks\(\)\.needsConfigurableIndexedPropertiesQuirk\(\)\) \[\[unlikely\]\]
            return [^\n]*\n    \}\n`,
    "\n",
  ),
  // [QuirksCanChangeAtRuntime].
  rule(
    String.raw`void JS\w+::reevaluateQuirkDependentPrototypeProperties\(JSDOMGlobalObject& globalObject\)\n\{\n(?:[^\n]*\n)*?\}\n\n`,
    "",
  ),
  rule(
    String.raw`\n    // Re-evaluates the runtime-enable conditions of \[QuirksCanChangeAtRuntime\] prototype
    // members, removing any that are no longer enabled\. No-op if the prototype does not exist yet\.
    static void reevaluateQuirkDependentPrototypeProperties\(JSDOMGlobalObject&\);\n`,
    "",
  ),
  // [Serializable]: only upstream's SerializedScriptValue asks. Bun has its own.
  rule(
    String.raw`bool JS\w+::isExposedInGlobalObject\(JSDOMGlobalObject& globalObject\)\n\{\n(?:[^\n]*\n)*?\}\n\n`,
    "",
  ),
  rule(
    String.raw`    static bool isExposedInGlobalObject\(JSDOMGlobalObject&\);\n    static constexpr bool isRestrictedToSameAgentCluster = \w+;\n`,
    "",
  ),
  // [CallWith=CurrentDocument] on a constructor. Bun's context is not a Document: a constructor knows its window (JSDOMConstructorBase::document()).
  rule(
    String.raw`    RefPtr context = castedThis->scriptExecutionContext\(\);
    if \(!context\) \[\[unlikely\]\]
        (return throwConstructorScriptExecutionContextUnavailableError\([^\n]*\);)
    Ref document = downcast<Document>\(\*context\);
`,
    `    auto* currentDocument = castedThis->document();
    if (!currentDocument) [[unlikely]]
        $1
    Ref document = *currentDocument;
`,
  ),
  // The same on a static operation (Document.parseHTMLUnsafe): `this` is the window's constructor.
  rule(
    String.raw`    RefPtr context = uncheckedDowncast<JSDOMGlobalObject>\(lexicalGlobalObject\)->scriptExecutionContext\(\);
    if \(!context\) \[\[unlikely\]\]
        return JSValue::encode\(jsUndefined\(\)\);
    Ref document = downcast<Document>\(\*context\);
`,
    `    auto* constructor = dynamicDowncast<JSDOMConstructorBase>(callFrame->thisValue());
    auto* currentDocument = constructor ? constructor->document() : nullptr;
    if (!currentDocument) [[unlikely]]
        return JSValue::encode(jsUndefined());
    Ref document = *currentDocument;
`,
  ),
  // [CallWith=EntryDocument] (document.open / write / writeln): there is no entry document.
  rule(
    String.raw`protect\(firstDOMWindow\(\*uncheckedDowncast<JSDOMGlobalObject>\(lexicalGlobalObject\)\)\.document\(\)\)\.get\(\), `,
    "",
  ),
  // Upstream makes a node's wrapper in the realm of the node's document. Every window of a global object shares that global's prototypes in Bun.
  rule(String.raw`    globalObject = globalObjectForNode\(impl\.get\(\), globalObject\);\n`, ""),
  // Bun's WebCoreOpaqueRootInlines.h does not include JSNodeCustomInlines.h (Bun's own bindings include it and must not reach Document.h).
  rule(
    String.raw`#include "WebCoreOpaqueRootInlines\.h"\n`,
    '#include "WebCoreOpaqueRootInlines.h"\n#include "JSNodeCustomInlines.h"\n',
  ),
  // HTMLDocument's named getter never gives a window: there are no frames.
  rule(
    String.raw`IDLUnion<IDLInterface<WindowProxy>, IDLInterface<Element>, IDLInterface<HTMLCollection>>`,
    "IDLUnion<IDLInterface<Element>, IDLInterface<HTMLCollection>>",
  ),
  // Bun's postTask() takes ownership of an EventLoopTask.
  rule(
    String.raw`context->postTask\(DeleteCallbackDataTask\(m_data\)\);`,
    "context->postTask(new DeleteCallbackDataTask(m_data));",
  ),
  // [EnabledBySetting] on a constructor.
  rule(
    String.raw`!downcast<Document>\(uncheckedDowncast<JSDOMGlobalObject>\(lexicalGlobalObject\)->scriptExecutionContext\(\)\)->settingsValues\(\)\.scopedCustomElementRegistryEnabled`,
    "true",
  ),
  // UIEvent.view and friends: there is no WindowProxy, a `Window` is an ordinary wrapped object.
  rule(String.raw`IDLInterface<WindowProxy>`, "IDLInterface<Window>"),
  rule(String.raw`#include "JSWindowProxy\.h"`, '#include "JSWindow.h"'),
  // Bun has no trusted types: `(TrustedHTML or DOMString)` in an IDL file is `DOMString`.
  rule(String.raw`IDLUnion<(?:IDLInterface<Trusted\w+>, )+(IDL\w+(?:<IDL\w+>)?)>`, "$1"),
];

/** file -> rules. Each stands for a change that cannot be made in an IDL file, or that would need a copy of a large one. */
export const rulesForOneFile: Record<string, Rule[]> = {
  "JSDOMParser.cpp": [
    // A window's DOMParser gives what it parses the URL of the window's document. The one from `import { DOMParser } from "bun:dom"` has no window.
    // (lists.ts knows a constructor that belongs to a window by the line with castedThis->document().)
    rule(
      String.raw`(    ASSERT\(castedThis\);
)(    RefPtr context = castedThis->scriptExecutionContext\(\);
(?:[^\n]*\n){2})    auto object = DOMParser::create\(\*context\);
`,
      `$1    auto* currentDocument = castedThis->document();
$2    auto object = currentDocument ? DOMParser::create(*currentDocument) : DOMParser::create(*context);
`,
    ),
  ],
  "JSXMLHttpRequest.cpp": [
    // A window's XMLHttpRequest resolves URLs against the window's document. The one from `import { XMLHttpRequest } from "bun:dom"` has no window.
    rule(
      String.raw`(    ASSERT\(castedThis\);
)(    RefPtr context = castedThis->scriptExecutionContext\(\);
(?:[^\n]*\n){2})    auto object = XMLHttpRequest::create\(\*context\);
`,
      `$1    auto* currentDocument = castedThis->document();
$2    auto object = currentDocument ? XMLHttpRequest::create(*currentDocument) : XMLHttpRequest::create(*context);
`,
    ),
  ],
  "JSTouchEvent.cpp": [
    // create() makes the arrays of touches, and nothing but the wrapper keeps them alive. The constructor holds them until it has made the wrapper.
    rule(
      String.raw`    auto object = TouchEvent::create\(\*castedThis->realm\(\), `,
      "    MarkedArgumentBuffer arrays;\n    auto object = TouchEvent::create(*castedThis->realm(), arrays, ",
    ),
  ],
  "JSHTMLOutputElement.cpp": [
    // Upstream's HTMLOutputElement.idl is the one HTML element with `[CallWith=CurrentDocument, HTMLConstructor] constructor()`, and `new HTMLOutputElement()` makes one.
    // The standard, the other browsers and jsdom say "Illegal constructor", as for every other element. So: no constructor.
    rule(String.raw`#include "JSDOMConstructor\.h"\n`, '#include "JSDOMConstructorNotConstructable.h"\n'),
    rule(
      String.raw`using JSHTMLOutputElementDOMConstructor = JSDOMConstructor<JSHTMLOutputElement>;\n`,
      "using JSHTMLOutputElementDOMConstructor = JSDOMConstructorNotConstructable<JSHTMLOutputElement>;\n",
    ),
    rule(
      String.raw`template<> EncodedJSValue JSC_HOST_CALL_ATTRIBUTES JSHTMLOutputElementDOMConstructor::construct\((?:[^\n]*\n)*?\}\nJSC_ANNOTATE_HOST_FUNCTION\(JSHTMLOutputElementDOMConstructorConstruct, JSHTMLOutputElementDOMConstructor::construct\);\n\n`,
      "",
    ),
  ],
  "JSRadioNodeList.cpp": [
    // The members of CachedLiveNodeList<RadioNodeList> are inline functions defined in LiveNodeListInlines.h.
    rule(
      String.raw`#include "JSRadioNodeList\.h"\n`,
      '#include "JSRadioNodeList.h"\n\n#include "LiveNodeListInlines.h"\n',
    ),
  ],
  "JSHTMLLinkElement.cpp": [
    // LinkStyle.sheet: a style sheet is never loaded. `null`, not a missing member.
    rule(
      String.raw`RELEASE_AND_RETURN\(throwScope, \(toJS<IDLNullable<IDLInterface<CSSStyleSheet>>>\(lexicalGlobalObject, \*thisObject\.realm\(\), throwScope, \[&\] -> decltype\(auto\) \{ return impl\.sheet\(\); \}\)\)\);`,
      "UNUSED_PARAM(impl);\n    RELEASE_AND_RETURN(throwScope, jsNull());",
    ),
  ],
  "JSCSSStyleProperties.cpp": [
    // The accessors of the CSS properties are made on demand: bindings/js/JSCSSStylePropertiesCustom.h.
    rule(
      String.raw`class JSCSSStylePropertiesPrototype final : public JSC::JSNonFinalObject \{\npublic:\n    using Base = JSC::JSNonFinalObject;`,
      "class JSCSSStylePropertiesPrototype final : public JSCSSStylePropertiesPrototypeBase {\npublic:\n    using Base = JSCSSStylePropertiesPrototypeBase;",
    ),
    rule(String.raw`        : JSC::JSNonFinalObject\(vm, structure\)\n`, "        : Base(vm, structure)\n"),
  ],
  "JSHTMLBodyElement.cpp": [
    // windowEventHandlerAttribute() / setWindowEventHandlerAttribute() have a header of their own in Bun.
    rule(
      String.raw`#include "JSEventListener\.h"\n`,
      '#include "JSEventListener.h"\n#include "JSWindowEventHandlerAttribute.h"\n',
    ),
  ],
  "JSHTMLFrameSetElement.cpp": [
    rule(
      String.raw`#include "JSEventListener\.h"\n`,
      '#include "JSEventListener.h"\n#include "JSWindowEventHandlerAttribute.h"\n',
    ),
  ],
  "JSRange.cpp": [
    // Range.idl: GenerateIsReachable=ReachableFromDOMWindow is for the selection's range, which the window keeps alive upstream.
    rule(
      String.raw`    auto\* jsRange = uncheckedDowncast<JSRange>\(handle\.slot\(\)->asCell\(\)\);
    // Cannot ref on the GC thread\.
    SUPPRESS_UNCOUNTED_LOCAL SUPPRESS_UNCHECKED_LOCAL auto\* owner = WTF::getPtr\(jsRange->wrapped\(\)\.window\(\)\);
    if \(!owner\)
        return false;
    if \(reason\) \[\[unlikely\]\]
        \*reason = "Reachable from Window"_s;
    return containsWebCoreOpaqueRoot\(visitor, owner\);
`,
      `    UNUSED_PARAM(handle);
    UNUSED_PARAM(visitor);
    UNUSED_PARAM(reason);
    return false;
`,
    ),
  ],
  "JSDocument.cpp": [
    // Document+HTML.idl: no open(url, name, features).
    rule(String.raw`static inline JSC::EncodedJSValue jsDocumentPrototypeFunction_open2Body\((?:[^\n]*\n)*?\}\n\n`, ""),
    rule(String.raw`jsDocumentPrototypeFunction_open2Body\(`, "jsDocumentPrototypeFunction_open1Body("),
    // Document+HTML.idl: defaultView is [ImplementedAs=window].
    rule(String.raw`impl\.windowProxy\(\)`, "impl.window()"),
  ],
  "JSWindow.cpp": [
    // The interfaces are lazy own properties of a window: a static table, which lists.ts writes.
    rule(
      String.raw`#include "config\.h"\n#include "JSWindow\.h"\n`,
      '#include "config.h"\n#include "JSWindow.h"\n\n#include "JSWindowInterfaces.h"\n#include <JavaScriptCore/Lookup.h>\n',
    ),
    rule(String.raw`(namespace WebCore \{\nusing namespace JSC;\n)`, '$1\n#include "JSWindowInterfaces.lut.h"\n'),
    rule(
      String.raw`const ClassInfo JSWindow::s_info = \{ "Window"_s, &Base::s_info, nullptr, nullptr,`,
      'const ClassInfo JSWindow::s_info = { "Window"_s, &Base::s_info, &jsWindowTable, nullptr,',
    ),
    // The object between Window.prototype and EventTarget.prototype: bindings/js/JSWindowProperties.h.
    rule(
      String.raw`#include "JSWindowInterfaces\.h"\n`,
      '#include "JSWindowInterfaces.h"\n#include "JSWindowProperties.h"\n',
    ),
    rule(
      String.raw`JSWindowPrototype::createStructure\(vm, &globalObject, JSEventTarget::prototype\(vm, globalObject\)\)`,
      "JSWindowPrototype::createStructure(vm, &globalObject, JSWindowProperties::create(vm, globalObject))",
    ),
    // windowEventHandlerAttribute() / setWindowEventHandlerAttribute() have a header of their own in Bun. `onerror` uses them.
    rule(
      String.raw`#include "JSEventListener\.h"\n`,
      '#include "JSEventListener.h"\n#include "JSWindowEventHandlerAttribute.h"\n',
    ),
  ],
  "JSWindow.h": [
    rule(
      String.raw`(    static constexpr unsigned StructureFlags = Base::StructureFlags)( \| )`,
      "$1 | JSC::HasStaticPropertyTable$2",
    ),
  ],
  "JSLocation.cpp": [
    // [LegacyUnforgeable] puts the members on the instance, as in browsers. They stay configurable and writable, so that a test can replace them.
    rule(
      String.raw`JSC::PropertyAttribute::DontDelete \| JSC::PropertyAttribute::ReadOnly \| JSC::PropertyAttribute::Function`,
      "static_cast<unsigned>(JSC::PropertyAttribute::Function)",
    ),
    rule(String.raw`(HashTableValue \{ "\w+"_s, )JSC::PropertyAttribute::DontDelete \| `, "$1"),
  ],
};
