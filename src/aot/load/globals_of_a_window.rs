//! `bun test` gives a test file that asks for a DOM the globals of a window: src/js/internal/test/environment.ts defines each of these names on `globalThis` anew.
//! No file of the run spells the stores, so the scan of the test files does not find them. test/aot/dom-environment.test.ts holds this list against that file.

use crate::builtins::table;

#[rustfmt::skip]
const NAMES: &[&str] = &[
    "DOMException", "EventTarget", "NamedNodeMap", "Node", "Attr", "Element", "DocumentFragment", "DOMImplementation",
    "Document", "XMLDocument", "CharacterData", "Text", "CDATASection", "ProcessingInstruction", "Comment",
    "DocumentType", "NodeList", "RadioNodeList", "HTMLCollection", "HTMLOptionsCollection", "DOMStringMap",
    "DOMTokenList", "StyleSheetList", "HTMLElement", "HTMLHeadElement", "HTMLTitleElement", "HTMLBaseElement",
    "HTMLLinkElement", "HTMLMetaElement", "HTMLStyleElement", "HTMLBodyElement", "HTMLHeadingElement",
    "HTMLParagraphElement", "HTMLHRElement", "HTMLPreElement", "HTMLUListElement", "HTMLOListElement",
    "HTMLLIElement", "HTMLMenuElement", "HTMLDListElement", "HTMLDivElement", "HTMLAnchorElement", "HTMLAreaElement",
    "HTMLBRElement", "HTMLButtonElement", "HTMLCanvasElement", "HTMLDataElement", "HTMLDataListElement",
    "HTMLDetailsElement", "HTMLDialogElement", "HTMLDirectoryElement", "HTMLFieldSetElement", "HTMLFontElement",
    "HTMLFormElement", "HTMLHtmlElement", "HTMLImageElement", "HTMLInputElement", "HTMLLabelElement",
    "HTMLLegendElement", "HTMLMapElement", "HTMLMarqueeElement", "HTMLMediaElement", "HTMLMeterElement",
    "HTMLModElement", "HTMLOptGroupElement", "HTMLOptionElement", "HTMLOutputElement", "HTMLPictureElement",
    "HTMLProgressElement", "HTMLQuoteElement", "HTMLScriptElement", "HTMLSelectElement", "HTMLSlotElement",
    "HTMLSourceElement", "HTMLSpanElement", "HTMLTableCaptionElement", "HTMLTableCellElement", "HTMLTableColElement",
    "HTMLTableElement", "HTMLTimeElement", "HTMLTableRowElement", "HTMLTableSectionElement", "HTMLTemplateElement",
    "HTMLTextAreaElement", "HTMLUnknownElement", "HTMLFrameElement", "HTMLFrameSetElement", "HTMLIFrameElement",
    "HTMLEmbedElement", "HTMLObjectElement", "HTMLParamElement", "HTMLVideoElement", "HTMLAudioElement",
    "HTMLTrackElement", "HTMLFormControlsCollection", "SVGElement", "SVGGraphicsElement", "SVGSVGElement",
    "SVGTitleElement", "SVGAnimatedString", "SVGNumber", "SVGStringList", "Event", "CloseEvent", "CustomEvent",
    "MessageEvent", "ErrorEvent", "HashChangeEvent", "PopStateEvent", "StorageEvent", "ProgressEvent",
    "PageTransitionEvent", "SubmitEvent", "UIEvent", "FocusEvent", "InputEvent", "MouseEvent", "KeyboardEvent",
    "TouchEvent", "CompositionEvent", "WheelEvent", "BarProp", "External", "Location", "History", "Screen", "Crypto",
    "Performance", "Navigator", "PluginArray", "MimeTypeArray", "Plugin", "MimeType", "FileReader", "FormData",
    "Blob", "File", "FileList", "ValidityState", "DOMParser", "XMLSerializer", "XMLHttpRequestEventTarget",
    "XMLHttpRequestUpload", "XMLHttpRequest", "WebSocket", "NodeFilter", "NodeIterator", "TreeWalker",
    "AbstractRange", "Range", "StaticRange", "Selection", "Storage", "CustomElementRegistry", "ShadowRoot",
    "MutationObserver", "MutationRecord", "Uint8Array", "Uint16Array", "Uint32Array", "Uint8ClampedArray",
    "Int8Array", "Int16Array", "Int32Array", "Float32Array", "Float64Array", "ArrayBuffer", "DOMRectReadOnly",
    "DOMRect", "Image", "Audio", "Option", "CSS", "addEventListener", "alert", "blur", "cancelAnimationFrame",
    "close", "confirm", "createPopup", "dispatchEvent", "document", "focus", "frames", "getComputedStyle", "history",
    "innerHeight", "innerWidth", "length", "localStorage", "location", "matchMedia", "moveBy", "moveTo", "name",
    "navigator", "open", "outerHeight", "outerWidth", "pageXOffset", "pageYOffset", "parent", "postMessage", "print",
    "prompt", "removeEventListener", "requestAnimationFrame", "resizeBy", "resizeTo", "screen", "screenLeft",
    "screenTop", "screenX", "screenY", "scroll", "scrollBy", "scrollLeft", "scrollTo", "scrollTop", "scrollX",
    "scrollY", "self", "sessionStorage", "stop", "top", "Window", "window", "reportError", "jsdom", "Request", "URL",
    "onerror", "onmessage", "Response", "MessagePort", "fetch", "Headers", "AbortController", "AbortSignal",
    "URLSearchParams",
];

/// Those of the names that are built-in objects of Bun, by their numbers in the table. Ascending.
pub(crate) fn globals_that_a_window_replaces() -> Vec<u32> {
    let mut globals: Vec<u32> = (NAMES.iter())
        .filter_map(|name| table::global(table::find_name(name.as_bytes())?))
        .map(|id| id as u32)
        .collect();
    globals.sort_unstable();
    globals.dedup();
    globals
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_the_built_ins_among_the_names() {
        let globals = globals_that_a_window_replaces();
        assert!(globals.is_sorted());
        for name in ["Uint8Array", "ArrayBuffer", "Event", "Blob", "fetch", "URL"] {
            let global = table::find_name(name.as_bytes()).and_then(table::global);
            assert!(
                global.is_some_and(|id| globals.contains(&(id as u32))),
                "{name}"
            );
        }
        let of_windows_alone = table::find_name(b"HTMLElement").and_then(table::global);
        assert!(of_windows_alone.is_none());
    }
}
