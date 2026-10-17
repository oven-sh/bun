// Made by src/codegen/webcore/lists.ts from the files in this directory. Do not edit.
#pragma once

#include "JSAbstractRange.h"
#include "JSAttr.h"
#include "JSBeforeUnloadEvent.h"
#include "JSCDATASection.h"
#include "JSCSSAnimationEvent.h"
#include "JSCSSConditionRule.h"
#include "JSCSSGroupingRule.h"
#include "JSCSSLayerBlockRule.h"
#include "JSCSSLayerStatementRule.h"
#include "JSCSSMediaRule.h"
#include "JSCSSRule.h"
#include "JSCSSRuleList.h"
#include "JSCSSStyleDeclaration.h"
#include "JSCSSStyleProperties.h"
#include "JSCSSStyleRule.h"
#include "JSCSSStyleSheet.h"
#include "JSCSSSupportsRule.h"
#include "JSCSSTransitionEvent.h"
#include "JSCharacterData.h"
#include "JSClipboardEvent.h"
#include "JSCommandEvent.h"
#include "JSComment.h"
#include "JSCompositionEvent.h"
#include "JSCustomElementRegistry.h"
#include "JSCustomStateSet.h"
#include "JSDOMImplementation.h"
#include "JSDOMMimeTypeArray.h"
#include "JSDOMParser.h"
#include "JSDOMPluginArray.h"
#include "JSDOMRect.h"
#include "JSDOMRectList.h"
#include "JSDOMRectReadOnly.h"
#include "JSDOMSelection.h"
#include "JSDOMStringMap.h"
#include "JSDOMTokenList.h"
#include "JSDocument.h"
#include "JSDocumentFragment.h"
#include "JSDocumentType.h"
#include "JSDragEvent.h"
#include "JSElement.h"
#include "JSElementInternals.h"
#include "JSFileList.h"
#include "JSFileReader.h"
#include "JSFocusEvent.h"
#include "JSFormDataEvent.h"
#include "JSHTMLAllCollection.h"
#include "JSHTMLAnchorElement.h"
#include "JSHTMLAreaElement.h"
#include "JSHTMLAudioElement.h"
#include "JSHTMLBRElement.h"
#include "JSHTMLBaseElement.h"
#include "JSHTMLBodyElement.h"
#include "JSHTMLButtonElement.h"
#include "JSHTMLCanvasElement.h"
#include "JSHTMLCollection.h"
#include "JSHTMLDListElement.h"
#include "JSHTMLDataElement.h"
#include "JSHTMLDataListElement.h"
#include "JSHTMLDetailsElement.h"
#include "JSHTMLDialogElement.h"
#include "JSHTMLDirectoryElement.h"
#include "JSHTMLDivElement.h"
#include "JSHTMLDocument.h"
#include "JSHTMLElement.h"
#include "JSHTMLEmbedElement.h"
#include "JSHTMLFieldSetElement.h"
#include "JSHTMLFontElement.h"
#include "JSHTMLFormControlsCollection.h"
#include "JSHTMLFormElement.h"
#include "JSHTMLFrameElement.h"
#include "JSHTMLFrameSetElement.h"
#include "JSHTMLHRElement.h"
#include "JSHTMLHeadElement.h"
#include "JSHTMLHeadingElement.h"
#include "JSHTMLHtmlElement.h"
#include "JSHTMLIFrameElement.h"
#include "JSHTMLImageElement.h"
#include "JSHTMLInputElement.h"
#include "JSHTMLLIElement.h"
#include "JSHTMLLabelElement.h"
#include "JSHTMLLegendElement.h"
#include "JSHTMLLinkElement.h"
#include "JSHTMLMapElement.h"
#include "JSHTMLMarqueeElement.h"
#include "JSHTMLMediaElement.h"
#include "JSHTMLMenuElement.h"
#include "JSHTMLMetaElement.h"
#include "JSHTMLMeterElement.h"
#include "JSHTMLModElement.h"
#include "JSHTMLOListElement.h"
#include "JSHTMLObjectElement.h"
#include "JSHTMLOptGroupElement.h"
#include "JSHTMLOptionElement.h"
#include "JSHTMLOptionsCollection.h"
#include "JSHTMLOutputElement.h"
#include "JSHTMLParagraphElement.h"
#include "JSHTMLParamElement.h"
#include "JSHTMLPictureElement.h"
#include "JSHTMLPreElement.h"
#include "JSHTMLProgressElement.h"
#include "JSHTMLQuoteElement.h"
#include "JSHTMLScriptElement.h"
#include "JSHTMLSelectElement.h"
#include "JSHTMLSelectedContentElement.h"
#include "JSHTMLSlotElement.h"
#include "JSHTMLSourceElement.h"
#include "JSHTMLSpanElement.h"
#include "JSHTMLStyleElement.h"
#include "JSHTMLTableCaptionElement.h"
#include "JSHTMLTableCellElement.h"
#include "JSHTMLTableColElement.h"
#include "JSHTMLTableElement.h"
#include "JSHTMLTableRowElement.h"
#include "JSHTMLTableSectionElement.h"
#include "JSHTMLTemplateElement.h"
#include "JSHTMLTextAreaElement.h"
#include "JSHTMLTimeElement.h"
#include "JSHTMLTitleElement.h"
#include "JSHTMLTrackElement.h"
#include "JSHTMLUListElement.h"
#include "JSHTMLUnknownElement.h"
#include "JSHTMLVideoElement.h"
#include "JSHashChangeEvent.h"
#include "JSHistory.h"
#include "JSInputEvent.h"
#include "JSKeyboardEvent.h"
#include "JSLocation.h"
#include "JSMediaList.h"
#include "JSMediaQueryList.h"
#include "JSMouseEvent.h"
#include "JSMutationObserver.h"
#include "JSMutationRecord.h"
#include "JSNamedNodeMap.h"
#include "JSNavigator.h"
#include "JSNode.h"
#include "JSNodeFilter.h"
#include "JSNodeIterator.h"
#include "JSNodeList.h"
#include "JSPageTransitionEvent.h"
#include "JSPointerEvent.h"
#include "JSPopStateEvent.h"
#include "JSProcessingInstruction.h"
#include "JSProgressEvent.h"
#include "JSPromiseRejectionEvent.h"
#include "JSRadioNodeList.h"
#include "JSRange.h"
#include "JSResizeObserver.h"
#include "JSSVGAnimatedPreserveAspectRatio.h"
#include "JSSVGAnimatedRect.h"
#include "JSSVGAnimatedString.h"
#include "JSSVGDefsElement.h"
#include "JSSVGDescElement.h"
#include "JSSVGElement.h"
#include "JSSVGGElement.h"
#include "JSSVGGraphicsElement.h"
#include "JSSVGMetadataElement.h"
#include "JSSVGNumber.h"
#include "JSSVGPreserveAspectRatio.h"
#include "JSSVGRect.h"
#include "JSSVGSVGElement.h"
#include "JSSVGStringList.h"
#include "JSSVGSwitchElement.h"
#include "JSSVGSymbolElement.h"
#include "JSSVGTitleElement.h"
#include "JSScreen.h"
#include "JSShadowRoot.h"
#include "JSStaticRange.h"
#include "JSStorage.h"
#include "JSStorageEvent.h"
#include "JSStyleSheet.h"
#include "JSStyleSheetList.h"
#include "JSSubmitEvent.h"
#include "JSText.h"
#include "JSTimeRanges.h"
#include "JSToggleEvent.h"
#include "JSTouchEvent.h"
#include "JSTreeWalker.h"
#include "JSUIEvent.h"
#include "JSValidityState.h"
#include "JSWheelEvent.h"
#include "JSWindow.h"
#include "JSXMLDocument.h"
#include "JSXMLHttpRequest.h"
#include "JSXMLHttpRequestEventTarget.h"
#include "JSXMLHttpRequestUpload.h"
#include "JSXMLSerializer.h"

// macro(the name script sees, the wrapper class): JSFoo::getConstructor().
#define FOR_EACH_DOM_BINDINGS_INTERFACE(macro) \
    macro(AbstractRange, JSAbstractRange) \
    macro(AnimationEvent, JSCSSAnimationEvent) \
    macro(Attr, JSAttr) \
    macro(BeforeUnloadEvent, JSBeforeUnloadEvent) \
    macro(CDATASection, JSCDATASection) \
    macro(CSSConditionRule, JSCSSConditionRule) \
    macro(CSSGroupingRule, JSCSSGroupingRule) \
    macro(CSSLayerBlockRule, JSCSSLayerBlockRule) \
    macro(CSSLayerStatementRule, JSCSSLayerStatementRule) \
    macro(CSSMediaRule, JSCSSMediaRule) \
    macro(CSSRule, JSCSSRule) \
    macro(CSSRuleList, JSCSSRuleList) \
    macro(CSSStyleDeclaration, JSCSSStyleDeclaration) \
    macro(CSSStyleProperties, JSCSSStyleProperties) \
    macro(CSSStyleRule, JSCSSStyleRule) \
    macro(CSSStyleSheet, JSCSSStyleSheet) \
    macro(CSSSupportsRule, JSCSSSupportsRule) \
    macro(CharacterData, JSCharacterData) \
    macro(ClipboardEvent, JSClipboardEvent) \
    macro(CommandEvent, JSCommandEvent) \
    macro(Comment, JSComment) \
    macro(CompositionEvent, JSCompositionEvent) \
    macro(CustomElementRegistry, JSCustomElementRegistry) \
    macro(CustomStateSet, JSCustomStateSet) \
    macro(DOMImplementation, JSDOMImplementation) \
    macro(DOMParser, JSDOMParser) \
    macro(DOMRect, JSDOMRect) \
    macro(DOMRectList, JSDOMRectList) \
    macro(DOMRectReadOnly, JSDOMRectReadOnly) \
    macro(DOMStringMap, JSDOMStringMap) \
    macro(DOMTokenList, JSDOMTokenList) \
    macro(Document, JSDocument) \
    macro(DocumentFragment, JSDocumentFragment) \
    macro(DocumentType, JSDocumentType) \
    macro(DragEvent, JSDragEvent) \
    macro(Element, JSElement) \
    macro(ElementInternals, JSElementInternals) \
    macro(FileList, JSFileList) \
    macro(FileReader, JSFileReader) \
    macro(FocusEvent, JSFocusEvent) \
    macro(FormDataEvent, JSFormDataEvent) \
    macro(HTMLAllCollection, JSHTMLAllCollection) \
    macro(HTMLAnchorElement, JSHTMLAnchorElement) \
    macro(HTMLAreaElement, JSHTMLAreaElement) \
    macro(HTMLAudioElement, JSHTMLAudioElement) \
    macro(HTMLBRElement, JSHTMLBRElement) \
    macro(HTMLBaseElement, JSHTMLBaseElement) \
    macro(HTMLBodyElement, JSHTMLBodyElement) \
    macro(HTMLButtonElement, JSHTMLButtonElement) \
    macro(HTMLCanvasElement, JSHTMLCanvasElement) \
    macro(HTMLCollection, JSHTMLCollection) \
    macro(HTMLDListElement, JSHTMLDListElement) \
    macro(HTMLDataElement, JSHTMLDataElement) \
    macro(HTMLDataListElement, JSHTMLDataListElement) \
    macro(HTMLDetailsElement, JSHTMLDetailsElement) \
    macro(HTMLDialogElement, JSHTMLDialogElement) \
    macro(HTMLDirectoryElement, JSHTMLDirectoryElement) \
    macro(HTMLDivElement, JSHTMLDivElement) \
    macro(HTMLDocument, JSHTMLDocument) \
    macro(HTMLElement, JSHTMLElement) \
    macro(HTMLEmbedElement, JSHTMLEmbedElement) \
    macro(HTMLFieldSetElement, JSHTMLFieldSetElement) \
    macro(HTMLFontElement, JSHTMLFontElement) \
    macro(HTMLFormControlsCollection, JSHTMLFormControlsCollection) \
    macro(HTMLFormElement, JSHTMLFormElement) \
    macro(HTMLFrameElement, JSHTMLFrameElement) \
    macro(HTMLFrameSetElement, JSHTMLFrameSetElement) \
    macro(HTMLHRElement, JSHTMLHRElement) \
    macro(HTMLHeadElement, JSHTMLHeadElement) \
    macro(HTMLHeadingElement, JSHTMLHeadingElement) \
    macro(HTMLHtmlElement, JSHTMLHtmlElement) \
    macro(HTMLIFrameElement, JSHTMLIFrameElement) \
    macro(HTMLImageElement, JSHTMLImageElement) \
    macro(HTMLInputElement, JSHTMLInputElement) \
    macro(HTMLLIElement, JSHTMLLIElement) \
    macro(HTMLLabelElement, JSHTMLLabelElement) \
    macro(HTMLLegendElement, JSHTMLLegendElement) \
    macro(HTMLLinkElement, JSHTMLLinkElement) \
    macro(HTMLMapElement, JSHTMLMapElement) \
    macro(HTMLMarqueeElement, JSHTMLMarqueeElement) \
    macro(HTMLMediaElement, JSHTMLMediaElement) \
    macro(HTMLMenuElement, JSHTMLMenuElement) \
    macro(HTMLMetaElement, JSHTMLMetaElement) \
    macro(HTMLMeterElement, JSHTMLMeterElement) \
    macro(HTMLModElement, JSHTMLModElement) \
    macro(HTMLOListElement, JSHTMLOListElement) \
    macro(HTMLObjectElement, JSHTMLObjectElement) \
    macro(HTMLOptGroupElement, JSHTMLOptGroupElement) \
    macro(HTMLOptionElement, JSHTMLOptionElement) \
    macro(HTMLOptionsCollection, JSHTMLOptionsCollection) \
    macro(HTMLOutputElement, JSHTMLOutputElement) \
    macro(HTMLParagraphElement, JSHTMLParagraphElement) \
    macro(HTMLParamElement, JSHTMLParamElement) \
    macro(HTMLPictureElement, JSHTMLPictureElement) \
    macro(HTMLPreElement, JSHTMLPreElement) \
    macro(HTMLProgressElement, JSHTMLProgressElement) \
    macro(HTMLQuoteElement, JSHTMLQuoteElement) \
    macro(HTMLScriptElement, JSHTMLScriptElement) \
    macro(HTMLSelectElement, JSHTMLSelectElement) \
    macro(HTMLSelectedContentElement, JSHTMLSelectedContentElement) \
    macro(HTMLSlotElement, JSHTMLSlotElement) \
    macro(HTMLSourceElement, JSHTMLSourceElement) \
    macro(HTMLSpanElement, JSHTMLSpanElement) \
    macro(HTMLStyleElement, JSHTMLStyleElement) \
    macro(HTMLTableCaptionElement, JSHTMLTableCaptionElement) \
    macro(HTMLTableCellElement, JSHTMLTableCellElement) \
    macro(HTMLTableColElement, JSHTMLTableColElement) \
    macro(HTMLTableElement, JSHTMLTableElement) \
    macro(HTMLTableRowElement, JSHTMLTableRowElement) \
    macro(HTMLTableSectionElement, JSHTMLTableSectionElement) \
    macro(HTMLTemplateElement, JSHTMLTemplateElement) \
    macro(HTMLTextAreaElement, JSHTMLTextAreaElement) \
    macro(HTMLTimeElement, JSHTMLTimeElement) \
    macro(HTMLTitleElement, JSHTMLTitleElement) \
    macro(HTMLTrackElement, JSHTMLTrackElement) \
    macro(HTMLUListElement, JSHTMLUListElement) \
    macro(HTMLUnknownElement, JSHTMLUnknownElement) \
    macro(HTMLVideoElement, JSHTMLVideoElement) \
    macro(HashChangeEvent, JSHashChangeEvent) \
    macro(History, JSHistory) \
    macro(InputEvent, JSInputEvent) \
    macro(KeyboardEvent, JSKeyboardEvent) \
    macro(Location, JSLocation) \
    macro(MediaList, JSMediaList) \
    macro(MediaQueryList, JSMediaQueryList) \
    macro(MimeTypeArray, JSDOMMimeTypeArray) \
    macro(MouseEvent, JSMouseEvent) \
    macro(MutationObserver, JSMutationObserver) \
    macro(MutationRecord, JSMutationRecord) \
    macro(NamedNodeMap, JSNamedNodeMap) \
    macro(Navigator, JSNavigator) \
    macro(Node, JSNode) \
    macro(NodeFilter, JSNodeFilter) \
    macro(NodeIterator, JSNodeIterator) \
    macro(NodeList, JSNodeList) \
    macro(PageTransitionEvent, JSPageTransitionEvent) \
    macro(PluginArray, JSDOMPluginArray) \
    macro(PointerEvent, JSPointerEvent) \
    macro(PopStateEvent, JSPopStateEvent) \
    macro(ProcessingInstruction, JSProcessingInstruction) \
    macro(ProgressEvent, JSProgressEvent) \
    macro(PromiseRejectionEvent, JSPromiseRejectionEvent) \
    macro(RadioNodeList, JSRadioNodeList) \
    macro(Range, JSRange) \
    macro(ResizeObserver, JSResizeObserver) \
    macro(SVGAnimatedPreserveAspectRatio, JSSVGAnimatedPreserveAspectRatio) \
    macro(SVGAnimatedRect, JSSVGAnimatedRect) \
    macro(SVGAnimatedString, JSSVGAnimatedString) \
    macro(SVGDefsElement, JSSVGDefsElement) \
    macro(SVGDescElement, JSSVGDescElement) \
    macro(SVGElement, JSSVGElement) \
    macro(SVGGElement, JSSVGGElement) \
    macro(SVGGraphicsElement, JSSVGGraphicsElement) \
    macro(SVGMetadataElement, JSSVGMetadataElement) \
    macro(SVGNumber, JSSVGNumber) \
    macro(SVGPreserveAspectRatio, JSSVGPreserveAspectRatio) \
    macro(SVGRect, JSSVGRect) \
    macro(SVGSVGElement, JSSVGSVGElement) \
    macro(SVGStringList, JSSVGStringList) \
    macro(SVGSwitchElement, JSSVGSwitchElement) \
    macro(SVGSymbolElement, JSSVGSymbolElement) \
    macro(SVGTitleElement, JSSVGTitleElement) \
    macro(Screen, JSScreen) \
    macro(Selection, JSDOMSelection) \
    macro(ShadowRoot, JSShadowRoot) \
    macro(StaticRange, JSStaticRange) \
    macro(Storage, JSStorage) \
    macro(StorageEvent, JSStorageEvent) \
    macro(StyleSheet, JSStyleSheet) \
    macro(StyleSheetList, JSStyleSheetList) \
    macro(SubmitEvent, JSSubmitEvent) \
    macro(Text, JSText) \
    macro(TimeRanges, JSTimeRanges) \
    macro(ToggleEvent, JSToggleEvent) \
    macro(TouchEvent, JSTouchEvent) \
    macro(TransitionEvent, JSCSSTransitionEvent) \
    macro(TreeWalker, JSTreeWalker) \
    macro(UIEvent, JSUIEvent) \
    macro(ValidityState, JSValidityState) \
    macro(WheelEvent, JSWheelEvent) \
    macro(Window, JSWindow) \
    macro(XMLDocument, JSXMLDocument) \
    macro(XMLHttpRequest, JSXMLHttpRequest) \
    macro(XMLHttpRequestEventTarget, JSXMLHttpRequestEventTarget) \
    macro(XMLHttpRequestUpload, JSXMLHttpRequestUpload) \
    macro(XMLSerializer, JSXMLSerializer)

// The ones among them whose constructor needs "the current document": each window has its own copy (JSDOMConstructorBase::createForWindow()).
#define FOR_EACH_DOM_BINDINGS_WINDOW_BOUND_INTERFACE(macro) \
    macro(Comment, JSComment) \
    macro(DOMParser, JSDOMParser) \
    macro(Document, JSDocument) \
    macro(DocumentFragment, JSDocumentFragment) \
    macro(HTMLElement, JSHTMLElement) \
    macro(Range, JSRange) \
    macro(Text, JSText) \
    macro(XMLHttpRequest, JSXMLHttpRequest)

// `new Image()`: JSFoo::getLegacyFactoryFunction(). All of them need the current document.
#define FOR_EACH_DOM_BINDINGS_LEGACY_FACTORY_FUNCTION(macro) \
    macro(Audio, JSHTMLAudioElement) \
    macro(Image, JSHTMLImageElement) \
    macro(Option, JSHTMLOptionElement)
